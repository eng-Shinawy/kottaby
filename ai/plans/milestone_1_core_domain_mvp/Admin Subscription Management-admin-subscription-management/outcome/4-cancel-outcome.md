# Task 4 Outcome — Cancel (balance-preserving): repo + service + mutation + tests (REQ-3, REQ-6, REQ-7)

**Date**: 2026-09-18
**Branch**: `feat/admin-subscription-management`
**Agent**: Task 4 Cancel Subagent
**Scope (exactly 8 modified files, no new files)**: `subscription.repository.ts` (+`cancelActiveOnce`), `subscription-admin.helpers.ts` (+reason normalizer + cancel-denial resolver), `subscription-admin.service.ts` (+`cancelSubscription`), `subscription-admin.service.test.ts` (+11 cancel tests), `subscription.repository.test.ts` (+3 cancel tests), `subscription-admin.pothos.ts` (+`CancelSubscriptionInput`), `subscription-admin.mutation.ts` (+`adminCancelSubscription`), `mutation/billing/index.ts` (docblock).

---

## 1. Summary

The admin CANCEL vertical is complete and verified. `SubscriptionRepository.cancelActiveOnce` performs the single guarded `UPDATE … WHERE id AND status='active' SET status='cancelled', updated_at=now RETURNING` — an explicit two-column patch that never reads or writes any lane balance column (balance-preserving by design, deliberately asymmetric with the expiry sweep's zeroing). `SubscriptionAdminService.cancelSubscription` owns the fail-closed orchestration: the optional free-text reason is trimmed and bounded (≤ 200 chars after trim) pre-DB, `assertActorAdmin` re-asserts the actor with zero writes on denial, and ONE `withTransaction` owns the guarded flip plus the exactly-one audit row (`AuditActionType.Suspend` on the `subscription` entity, details `{ fromStatus: "active", toStatus: "cancelled", reason? }` — the status members flow from the enum objects, the reason is omitted entirely when not supplied). The zero-row guarded write is DISAMBIGUATED by a fresh read on the same executor: a vanished row → the canonical `NotFoundError("SUBSCRIPTION", …)` denial, an already-cancelled row → the idempotent localized replay conflict (`CONFLICT` default code), any other state → the localized `notActive` conflict — all with zero writes and zero audit rows. The disambiguation read runs ONLY after the write has already failed, so the guard lives entirely inside the UPDATE's WHERE (no read-then-write premise). `adminCancelSubscription` exposes it admin-only through Pothos (`CancelSubscriptionInput { subscriptionId: ID!, reason: String }`, `reason: args.input.reason ?? undefined` maps the wire null away at the boundary); both billing barrels carry the surface.

## 2. Files created / modified

| # | File | Change |
|---|------|--------|
| 1 | `backend/db/repo/billing/subscription.repository.ts` | + `cancelActiveOnce(id, tx?)` — guarded UPDATE (`WHERE id AND status='active'`), explicit two-column SET (`status: SubscriptionStatus.Cancelled`, `updatedAt: new Date()`), `RETURNING` row or `null`; docblock pins the balance-preserving contract |
| 2 | `backend/services/billing/subscription-admin.helpers.ts` | + `CANCEL_REASON_MAX_LENGTH = 200`, `normalizeCancelReason(rawReason, subscriptionId, tErrors)` (trim → bound → collapse-blank-to-absent; overlong → localized `badRequest` validation reject; the reason never enters a log), `resolveCancelDenial(subscriptionId, current, tErrors)` (`: never` — not-found / already-cancelled replay / not-active ladder, one bounded id-only log each); `ValidationError` joined the errors import |
| 3 | `backend/services/billing/subscription-admin.service.ts` | + `cancelSubscription(input, actorId, locale, tx?)` — pre-DB reason normalization → `assertActorAdmin` → one `withTransaction` owning the guarded `cancelActiveOnce`, the null-path disambiguation read, the exactly-one `Suspend` audit row, and the `ReturnType` mapping; outer catch → `toSubscriptionAdminDomainError`; header docblock documents the cancel semantics |
| 4 | `backend/graphql/pothos/billing/subscription-admin.pothos.ts` | + `CancelSubscriptionInput` (string-named `inputType`: required `subscriptionId` id, optional `reason` string) + docblock |
| 5 | `backend/graphql/mutation/billing/subscription-admin.mutation.ts` | + `adminCancelSubscription` — `adminOnlyAuthScopes` + `requireAdminUser(ctx)`, field-by-field whitelist copy (`reason ?? undefined`), `user.id` + `ctx.locale` propagation, side-effect registration, docblock contract |
| 6 | `backend/graphql/mutation/billing/index.ts` | + docblock line naming `adminCancelSubscription` (side-effect import already present) |
| 7 | `backend/db/test/logic/billing/subscription.repository.test.ts` | + 3 cancel tests (happy path incl. updatedAt stamp + untouched rider columns; double-cancel zero-row replay stability + unknown id; every non-active state denies via the `expectCancelDeniedForStatus` probe) |
| 8 | `backend/services/billing/subscription-admin.service.test.ts` | + 11 cancel tests + fixtures (`createCancellableFixture` — student owner + Hifz-lane plan + active row + pre-credited non-zero lane; `readLaneBalances` — all four lane columns; `cancelInput`; `expectCancelDenied` zero-write probe; `expectAuditDetailsWithoutReason`) |

## 3. Replay-vs-not-found disambiguation (the task's critical design point)

`cancelActiveOnce` returning `null` carries three meanings that the service MUST split (all denials zero-write, zero-audit, one bounded `logDomainError` with ids only):

| Fresh read on the same executor | Surfaced denial | `extensions.code` | Localized copy |
|---|---|---|---|
| Row missing | `new NotFoundError("SUBSCRIPTION", tErrors.notFound)` | `SUBSCRIPTION_NOT_FOUND` | `errorsTranslations.notFound` |
| `status === 'cancelled'` (replay — the denied call wrote nothing; the first cancel did) | `new ConflictError(tErrors.conflict)` — DEFAULT-code form, never a custom machine key | `CONFLICT` | generic idempotent-conflict copy (the Task 2 extend-replay precedent) |
| Any other non-active state | `new ConflictError(tErrors.subscriptionAdmin.notActive)` | `CONFLICT` | `errorsTranslations.subscriptionAdmin.notActive` |

The read is a pure disambiguation probe on the loser path — it never precedes the write, so the guarded WHERE remains the only write premise (plan §6.3 TOCTOU rule).

## 4. 4.QL Quality Loop — per-file sub-loop results

`bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (progressive tsgo → oxlint → biome → lint:type-aware → check:duplicates). **All 8 files exit 0.** Two findings fixed along the way:

1. `subscription-admin.service.ts` — oxlint `max-lines` (file-level, 300 counted lines): the initially-inline cancel helpers pushed the service file over. Extracted `normalizeCancelReason` + `resolveCancelDenial` (+ the widened `STATUS_CANCELLED` const) into the shared `subscription-admin.helpers.ts` module (the Task 3 lesson applied at file scope: split helpers instead of inlining). Re-run → exit 0.
2. `subscription-admin.service.test.ts` — oxlint `no-await-in-loop` warning on the omitted/blank-reason assertion loop: unrolled into the `expectAuditDetailsWithoutReason` helper called once per fixture. Re-run → exit 0 with 0 warnings.

Whole-repo confirmation: `bun tsgo` → **exit 0, 0 errors** (baseline was 0; delta stays 0).

## 5. 4.TE Tests (mandated runner, never raw `bun test`; Postgres 17 up at 127.0.0.1:5432/app_db)

| Command | Result |
|---------|--------|
| `bun run test/scripts/run-test.ts backend/db/test/logic/billing/subscription.repository.test.ts` | **12 pass / 0 fail** (101 expect calls) — run twice, stable |
| `bun run test/scripts/run-test.ts backend/services/billing/subscription-admin.service.test.ts` | **39 pass / 0 fail** (297 expect calls) — run twice, stable |

Service-suite cancel coverage map actually exercised: happy path (status flip, lane quadruple BYTE-IDENTICAL before/after with a pre-credited non-zero lane, exactly one `Suspend` audit row with actor/entity/entityId and the details triple + TRIMMED reason parsed back verbatim) · reason omitted → details carry EXACTLY `{ fromStatus, toStatus }` (no key); whitespace-only reason collapses to absent · not-active denials: pending / expired (TRUE expired-status fixture) / suspended → localized `notActive` conflict, zero writes, zero audits · already-cancelled row (double-cancel AND fixture-level) → idempotent localized `conflict` replay, no second write, exactly one audit row, lanes byte-identical · unknown id → `NotFoundError` with the canonical `SUBSCRIPTION_NOT_FOUND` code and the localized not-found copy · reason > 200 trimmed chars → pre-DB `VALIDATION` reject (`badRequest`), row still active, zero audits · exactly 200 trimmed chars → inclusive-bound commit, stored reason = the trimmed body · non-admin → `FORBIDDEN` before any write (row byte-identical incl. `updatedAt`, lane untouched, zero audits by actor AND entity) · anonymous → `UNAUTHORIZED`. All 28 prior tests (15 extend + 13 renew) remained green untouched.

## 6. 4.SEC Security

- **BOLA/BFLA**: the actor id is server-bound (`requireAdminUser(ctx)` → `user.id`, never an arg) and re-asserted against the `users` table (`assertActorAdmin`) BEFORE any write — non-admin/anonymous denials leave the row byte-identical (incl. `updatedAt`) and mint zero audit rows (asserted).
- **BOPLA**: `CancelSubscriptionInput` whitelists exactly `subscriptionId` + `reason`; the mutation copies field-by-field (the wire `null` reason becomes `undefined` at the boundary — never spread); the repo patch touches exactly `status` + `updated_at`. No client input reaches a `set()` or a claim key.
- **Audit PII**: the trimmed, ≤ 200-char reason is the ONLY free text anywhere in the trail (the audit-contract vocabulary was ids/ints/ISO strings before this task); denial logs carry ids only — the reason never enters a diagnostic log. `AuditService.createAuditLog`'s `truncateDetailsSafely` stays the backstop.
- **Races/TOCTOU**: the WHERE predicate IS the lock — `status='active'` re-evaluated under the row lock at UPDATE time; a concurrent extend/plan-change/expiry winner makes the loser's UPDATE match zero rows and the fresh read classifies the outcome. The balance-preserving guarantee is structural: no lane column is reachable from the cancel flow at all.

## 7. 4.SR / 4.IV Semantic review & instruction verification

- **Enums-as-values**: `SubscriptionStatus.Active` / `.Cancelled` are VALUE-imported members in the repo guard, the audit details, and the widened `STATUS_CANCELLED` const; `AuditActionType.Suspend` is a value import. `rg` for quoted status literals over the runtime files → only SQL-shape DOCBLOCK text (the pre-existing docblock idiom), zero runtime literals.
- **Guard in WHERE, no dead branches**: no read-then-write premise (the disambiguation read runs only on the already-failed write path); every branch is test-pinned — reason over/under bound, blank/absent reason, all four non-active states, unknown id, replay, success with/without reason, non-admin, anonymous.
- **Cross-layer imports**: repo → schema/enum/types only; service → repo/helpers/lib/enum/types; mutation → pothos/shared/service/helpers; no service→GraphQL or repo→service edges; types via `@/backend/types` (no local `.types.ts`); the cancel helpers live in the shared helpers module (runtime only).
- **Comments**: `rg "REQ-|Phase|Task 4|tasks\.md|specs\.md|plans/|plan\.md|milestone"` over all 8 files → **0 matches**; comments state domain constraints only (guard-as-lock, balance-preserving asymmetry, replay classification, reason as the trail's only free text).
- **Scope**: `git status --porcelain` = exactly the 8 files above (+ gitignored logs); no schema, no migration, no codegen, no shared/ changes; `deferred-items.md` untouched (nothing deferred by this task). SDL regeneration remains deliberately deferred to Task 6 per plan.
- **4.IV**: sub-loop-printed instruction files read and honored — `backend.instructions.md` (layer separation, no local Pothos types, DomainError contract), `tests.instructions.md` (runInRollback + tx propagation, try/catch rejection helper, run-test script only, no `oxlint-disable`), `backend/db/repo/AGENTS.md` (guarded transitions + RETURNING, zero-row = miss signal for the service tier), `backend/db/test/AGENTS.md`, `backend/services/AGENTS.md` (single-writer outerTx-last convention, no service `.types.ts`), `backend/graphql/mutation/AGENTS.md` (side-effect-only registration, resolver delegation, no inline business logic), `backend/graphql/AGENTS.md` + `backend/graphql/pothos/AGENTS.md` (input whitelist boundary, string-named inputType).

## 8. Carry-forward knowledge (for Task 5 — plan change)

- **The cancel flow is Task 5's "old row" writer**: `changeSubscriptionPlan` must flip the old row to `cancelled` — reuse `cancelActiveOnce(id, scopedTx)` inside the plan-change transaction (it is already the exact guarded transition; do NOT re-read-then-write the old row).
- **Helpers now carry**: `normalizeCancelReason` / `CANCEL_REASON_MAX_LENGTH` (Task 5 has no reason field — nothing to do), `resolveCancelDenial` (Task 5's old-row flip needs NO disambiguation: the plan-change flow reads the row first under its own guards; a null from `cancelActiveOnce` there should fail closed with the localized conflict — the claim + fresh reads make the lost-race window harmless).
- **Claim ladder for Task 5** (from Task 3): copy `renewSubscription`'s savepoint-bracketed claim with key `planChange:<sourceId>:<newPlanId>` — add the `planChange` member to `SUBSCRIPTION_ADMIN_CLAIM_PREFIXES`; the 23505 → `findByKey` → pointer-load → same-owner check → return-first-result ladder is `resolveRenewalReplayRow`; pointer-less claim → NEW `alreadyPlanChanged` key (already present in the i18n group) in the default-code form.
- **Repo gaps Task 5 must fill**: `setLaneBalanceValue` on `student.repository.ts` (lane reset with explicit `updatedAt`, CHECK-constraint negative-lane catch → domain conflict), `findActiveWithPlan` on `subscription.repository.ts` (per plan §3.1 — executor-less path uses the `queryDb` raw pattern), `computeProration` helpers (BigInt minor units, canonical decimal-string parsing), plus the `ProrationDirection` registration in `shared/enum.pothos.ts` (deferred from Task 1). Each new repo method needs its own repo-test rows.
- **File-level `max-lines` (300) is real on service files**: keep splitting helpers into `subscription-admin.helpers.ts` (or a new sibling module) from the start; the plan-change flow has more guards than renew — budget for it. Function-level 75 also still applies (the oxlint `max-lines-per-function` ceiling).
- **Test conventions that made cancel green**: `createCancellableFixture` pre-credits the lane so the byte-identical assertion is non-trivial (`expect(lanesBefore.hifz).toBeGreaterThan(0)` first); `readLaneBalances` compares ALL four lane columns via `toEqual` on the quadruple; the audit-details shape is pinned with enum members (`fromStatus: SubscriptionStatus.Active`), never quoted status strings; derive nothing from a separately captured clock (cancel stamps `updatedAt` — asserted `>=` the fixture's own).
- **Denial-ladder asymmetry to preserve**: cancel's unknown-id → NOT_FOUND differs from extend/renew's unknown-id → notActive/notExpired conflict (their pre-read guard classifies before the write; cancel's guard IS the write). Task 5 should classify unknown-source via its own pre-read (it has one anyway for the plan read) and keep custom machine keys out of every ConflictError.

## 9. Cross-file dependencies

- `subscription-admin.service.ts` → `subscription.repository.ts` (`cancelActiveOnce`, `findById`), `subscription-admin.helpers` (`normalizeCancelReason`, `resolveCancelDenial`, audit contract, error translation, row mapping), `admin-gate.helpers` (`assertActorAdmin`), `audit.service` (`createAuditLog`), `with-transaction`, `errors` (`ConflictError`/`ValidationError` via the mapper), `logger`, `@/shared/locale/server-graphql`.
- `subscription-admin.mutation.ts` → `subscription-admin.pothos.ts` (`CancelSubscriptionInput`) + `subscription.pothos.ts` (`SubscriptionPothosObject`) + `@/backend/graphql/shared` (`adminOnlyAuthScopes`, `requireAdminUser`) + helpers (`coerceSubscriptionId`) + service.
- Both billing barrels carry the cancel surface alongside extend/renew; Task 5 appends its mutation/input to the SAME two barrels and the same service/helpers namespaces — no new barrels needed.
- Audit census (Task 9): `adminCancelSubscription` mints `Suspend` rows — the D-001 deferred row replacement in `test/workflows/admin/audit-completeness.catalog.ts` must include `[Update (extend), Suspend (cancel)]` per plan §5.2.
