# Task 2 Outcome — Extend: repo + service + mutation (REQ-1, REQ-6, REQ-7)

**Date**: 2026-09-18
**Branch**: `feat/admin-subscription-management`
**Agent**: Task 2 Finisher Subagent (verification, fixes, test completion)
**Scope (exactly 9 files)**: 4 modified (`subscription.repository.ts`, `subscription.repository.test.ts`, both `billing` GraphQL barrels) + 5 new (`subscription-admin.mutation.ts`, `subscription-admin.pothos.ts`, `subscription-admin.helpers.ts`, `subscription-admin.service.ts`, `subscription-admin.service.test.ts`).

---

## 1. Summary

The admin EXTEND vertical is complete and verified. `SubscriptionRepository.extendActiveOnce` performs the single guarded `UPDATE … WHERE id AND status='active' AND end_date=<previousEndDate> … RETURNING`; `SubscriptionAdminService.extendSubscription` owns the fail-closed orchestration (pre-DB day validation → `assertActorAdmin` → one `withTransaction` owning read + guarded write + exactly-one audit row); `adminExtendSubscription` exposes it admin-only through Pothos with the strict wire-id coercion; both billing barrels are wired. The new window end is computed SERVER-SIDE in the service (`previousEndDate + days × 86_400_000`); the repo only SETs the absolute value behind the guard — no client-dictated dates, no `SET … + INTERVAL` duality.

## 2. Files created / modified

| # | File | Change |
|---|------|--------|
| 1 | `backend/db/repo/billing/subscription.repository.ts` | + `extendActiveOnce(id, {previousEndDate, newEndDate}, tx?)` — guarded UPDATE with explicit two-column patch (`endDate`, `updatedAt: new Date()`), `SubscriptionStatus.Active` enum member in the WHERE, `RETURNING` row or `null` |
| 2 | `backend/db/test/logic/billing/subscription.repository.test.ts` | + extend happy path (exact window shift, all other columns ride through), replay→zero-row (no second shift, unknown id probe), wrong-status denial for every non-active lifecycle state |
| 3 | `backend/services/billing/subscription-admin.service.ts` | **NEW** — `extendSubscription`: integer-≥1 day validation (localized `badRequest`), `assertActorAdmin` BEFORE writes, active+windowed read guard (`notActive` denial, zero writes), service-side `newEndDate`, `MAX_INTERVAL_DAYS` ceiling (`prorationOverflow`), replay→idempotent localized conflict (zero audit), ONE `AuditService.createAuditLog` (`Update` / `"subscription"` / ISO+int details) inside the same tx, outer catch → `toSubscriptionAdminDomainError` |
| 4 | `backend/services/billing/subscription-admin.helpers.ts` | **NEW** — `buildSubscriptionAuditContract` (details = ids/ints/ISO strings only, JSON-stringified), `coerceSubscriptionId` (strict `Number()` parse → `SUBSCRIPTION_NOT_FOUND`), `toSubscriptionAdminDomainError` (cycle-safe 23505 walker → localized conflict), `toSubscriptionAdminReturnType` (fail-closed closed-vocabulary enum mapping, never a cast) |
| 5 | `backend/services/billing/subscription-admin.service.test.ts` | **NEW** — 15 tests, four tiers against live Postgres on real repositories (see §4) |
| 6 | `backend/graphql/pothos/billing/subscription-admin.pothos.ts` | **NEW** — string-named `inputType("ExtendSubscriptionInput")` (`subscriptionId: t.id`, `days: t.int`), BOPLA whitelist |
| 7 | `backend/graphql/mutation/billing/subscription-admin.mutation.ts` | **NEW** — `adminExtendSubscription` with `adminOnlyAuthScopes` + `requireAdminUser(ctx)`, field-by-field copy into the service whitelist, `user.id` + `ctx.locale` propagation, no named exports (side-effect registration) |
| 8 | `backend/graphql/mutation/billing/index.ts` | + side-effect import `./subscription-admin.mutation` + header docblock line |
| 9 | `backend/graphql/pothos/billing/index.ts` | + `export * from "./subscription-admin.pothos"` + header docblock update (input lands ahead of its resolver) |

## 3. Fixes applied during verification (prior agent's draft → green)

1. **Canonical conflict codes (`subscription-admin.service.ts`)** — the not-active and replay denials used the custom-code `ConflictError` overload (`"SUBSCRIPTION_NOT_ACTIVE"` / `"SUBSCRIPTION_EXTEND_REPLAY"` as `extensions.code`). Those machine keys are not in `backend/lib/errors/error-code-taxonomy.ts`; the canonical taxonomy carries `CONFLICT` (→ 409). Switched both to the default-code form `new ConflictError(localizedMessage)` so `extensions.code = "CONFLICT"` with the localized message intact — matching the helper file's own precedent and the test contract.
2. **"Expired" fixture built the wrong state (`subscription-admin.service.test.ts`)** — the test overrode only `endDate` to the past on an **active** row and expected denial. Per design, `status` is the arbiter and the sweep owns `active → expired`: an active row whose window merely closed is legitimately extendable (the exact use case). Fixed the fixture to override `status: SubscriptionStatus.Expired` — a true non-active state, matching the coverage map and the repo-level per-status denial probe.
3. **Ceiling-boundary clock drift (`subscription-admin.service.test.ts`)** — the "exactly ON the ceiling" assertion compared against a separately captured `new Date()` instead of the fixture's own window end (few-ms drift → flaky equality). The expected end now derives from the fixture row's `endDate`; the stray clock variable was removed.
4. **Non-deterministic double-submit race (`subscription-admin.service.test.ts`)** — `Promise.allSettled` over two production-path calls does not guarantee the lost-race interleaving: when the loser's `findById` lands after the winner's commit the design says extensions legitimately STACK (2 shifts, 2 audits) and the exactly-one partition assertion fails. Added a read barrier: `findById` is spy-stubbed (real call first) to hold both transactions until both have read the row, then releases both — the two guarded UPDATEs now deterministically contend on the SAME `previousEndDate` across the row lock. The real guarded statement, row lock, and audit write remain fully exercised; the spy is tracked/restored via the file's existing `afterEach`.

## 4. 2.QL Quality Loop — per-file sub-loop results

`bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (progressive tsgo → oxlint → biome → lint:type-aware → check:duplicates). **All 9 files exit 0** (the two files fixed in §3 were re-run after their edits — exit 0).

Whole-repo confirmation: `bun tsgo` → **exit 0, 0 errors** (`grep -c "error TS"` = 0). Baseline was 0; delta remains 0.

## 5. 2.TE Tests (mandated runner, never raw `bun test`)

| Command | Result |
|---------|--------|
| `bun run test/scripts/run-test.ts backend/db/test/logic/billing/subscription.repository.test.ts` | **9 pass / 0 fail** (72 expect calls) |
| `bun run test/scripts/run-test.ts backend/services/billing/subscription-admin.service.test.ts` | **15 pass / 0 fail** (108 expect calls) — re-run twice, stable |

Service-suite coverage map actually exercised: happy extend (exact shift + exactly one `Update` audit row with the `{previousEndDate, newEndDate, addedDays}` ISO+int triple parsed back verbatim) · all four non-active states + unknown id deny `notActive` with zero writes/audits · fractional + non-positive day counts reject pre-DB · non-admin → `FORBIDDEN` (row byte-identical incl. `updatedAt`, zero audits by actor AND entity) · anonymous → `UNAUTHORIZED` · `days = 1` minimal shift · windowless active row denies · ceiling: one day over rejects (`prorationOverflow`), exactly ON the ceiling commits (inclusive bound vs `MAX_INTERVAL_DAYS = 3650` measured from `startDate`) · replay stub probe (localized `conflict`, exactly one bounded `logDomainError`, zero audit) · TRUE-concurrency double-submit on independent transactions (read barrier): exactly one shift + one audit, loser gets `CONFLICT`, FK-ordered committed-fixture teardown.

## 6. 2.SEC Security

- **BOLA/BFLA**: the actor id is server-bound (`requireAdminUser(ctx)` → `user.id`, never an arg) and re-asserted against the `users` table (`assertActorAdmin`) BEFORE any write — non-admin/anonymous denials leave the row byte-identical and mint zero audit rows (asserted).
- **BOPLA**: Pothos input whitelist (`subscriptionId`, `days`) copied field-by-field into the service's `ExtendSubscriptionSubmitInput`; the repo patch touches exactly `end_date` + `updated_at`. No spreads of client input anywhere.
- **Races/TOCTOU**: the WHERE predicate IS the lock — `status='active' AND end_date=<previousEndDate>` re-evaluated under the row lock at UPDATE time; read-then-write is only safe because the write re-asserts the read's premise (proven by the true-concurrency test). Replay/lost-race → idempotent localized conflict, zero audit rows.
- **Audit hygiene**: details = ids, integers, ISO date strings only; one audit row per committed mutation, sharing the transaction's fate.

## 7. 2.SR / 2.IV Semantic review & instruction verification

- **Enums-as-values**: `SubscriptionStatus.Active` / `.Pending` / `.Expired` / `.Cancelled` / `.Suspended` and `AuditActionType.Update` are VALUE-imported members everywhere (repo guard, service guard, helpers' `Object.values` vocabularies, test fixtures); zero runtime status/action string literals. `PaymentGateway`/`SubscriptionStatus` mapping resolves members by the enum objects' own values — never a cast.
- **Cross-layer imports**: repo → schema/enum/types only; service → repo/helpers/lib/enum/types; mutation → pothos/shared/service/helpers; no service→GraphQL or repo→service edges; types imported via `@/backend/types` (no local `.types.ts` in services).
- **Comments**: `rg "REQ-|Phase|Task 2|tasks\.md|specs\.md|plans/|plan\.md|milestone"` over all 9 files → **0 matches**; every comment states a non-obvious domain constraint (guard-as-lock, sweep-owned transitions, barrier rationale, audit vocabulary), no trivia.
- **Scope**: `git status --porcelain` = exactly the 9 files above (+ gitignored `.env.test`/`logs/`); no schema, no migrations, no codegen, no shared/ changes.
- **Dead branches**: every guard is reachable and test-pinned (fractional/≤0 days, missing/windowless/non-active rows, ceiling over/inclusive, replay, unique-violation translation); no unreachable or duplicated logic; `withTransaction` SAVEPOINT-vs-top-level both exercised (rollback suite + production-path chaos test).
- **Sub-loop-printed rule files** (backend/db/repo, db/test, graphql/mutation, services, lib AGENTS.md and instructions) — read and honored: side-effect-only mutation barrels, no named exports, `runInRollback` discipline, no `expect(...).rejects` inside rollbacks, spy-restore hygiene, strict numeric id coercion.

## 8. Carry-forward knowledge (for Tasks 3–5)

- **Audit contract pattern**: `buildSubscriptionAuditContract(actorId, AuditActionType.X, entityId, detailsObject)` from `@/backend/services/billing/subscription-admin.helpers` — `entityType` is the module const `SUBSCRIPTION_AUDIT_ENTITY_TYPE = "subscription"`; details must stay ids/ints/ISO strings (Task 4 adds `reason` — trimmed, ≤200 chars; Task 5 uses the `Override` action with proration details). Call it INSIDE the service transaction via `AuditService.createAuditLog(contract, scopedTx)`.
- **Service transaction shape**: validate cheap input pre-DB → `await assertActorAdmin(actorId, locale, tx)` → `return await withTransaction(tx, async scopedTx => { read → guard → guarded repo write → one audit → map ReturnType })` → outer `catch (e) { throw toSubscriptionAdminDomainError(e, tErrors) }`. Every denial inside logs ONE bounded `logger.logDomainError` with ids only, then throws the localized DomainError with the DEFAULT code form (`new ConflictError(msg)`, `new ValidationError(msg)`) so `extensions.code` stays in the taxonomy (`CONFLICT`, `VALIDATION`) — do NOT invent machine codes.
- **Replay-conflict localization**: a guarded write returning `null` throws `new ConflictError(tErrors.conflict)` (generic idempotent-conflict copy, zero audit). For Tasks 3/5 the claim-key 23505 path instead REPLAYS (read claim → return its subscription row) — the extend-style null-conflict applies to Task 4's `cancelActiveOnce` double-cancel.
- **Deterministic concurrency testing**: to pin a lost race, barrier the shared READ (spy-stub the repo finder: real call → count arrivals → release both) so both transactions contend on the same predicate; without it the second read may land post-commit and legitimately stack. Committed fixtures + FK-ordered teardown (`deleteUsersByIds` first, then plan) for anything that must survive across connections; `testOnRealPostgres` gate via `isPgliteProvider()`.
- **Fixture/test conventions**: `createActiveSubscription(tx, overrides)` spreads overrides AFTER defaults (status flips work); derive expected dates from the FIXTURE's stored values, never a separately captured clock (ms drift breaks `toEqual`); `expectServiceError` try/catch helper instead of `.rejects` inside `runInRollback`; per-file spy registry restored in `afterEach` (bun reuses one mock per object+method pair).

## 9. Cross-file dependencies

- `subscription-admin.service.ts` → `subscription.repository.ts` (`findById`, `extendActiveOnce`), `admin-gate.helpers` (`assertActorAdmin`), `audit.service` (`createAuditLog`), `plan-catalog.helpers` (`MAX_INTERVAL_DAYS = 3650`), `subscription-admin.helpers` (audit contract / id coercion / error translation / row mapping), `with-transaction`, `errors`, `logger`, `@/shared/locale/server-graphql`.
- `subscription-admin.mutation.ts` → `subscription-admin.pothos.ts` (input) + `subscription.pothos.ts` (return object `SubscriptionPothosObject`) + `@/backend/graphql/shared` (`adminOnlyAuthScopes`, `requireAdminUser`) + helpers (`coerceSubscriptionId`) + service.
- Both billing barrels → the two new modules (side-effect / re-export); downstream Tasks 3–5 add their mutations/inputs to the same two barrels and the same service/helpers namespaces — no new barrels needed.
- SDL note: `adminExtendSubscription` exists in code but `gqlSchema.definitions.ts` regeneration is deliberately deferred to Task 6 (schema regen step); nothing in this task touches generated files.
