# Task 6 Outcome — Admin query `adminStudentSubscriptions` + schema regeneration (REQ-5, REQ-7)

**Date**: 2026-09-19
**Branch**: `feat/admin-subscription-management`
**Agent**: Task 6 Subagent (Phase 3 — admin read query + GraphQL schema regeneration)
**Scope (3 modified + 2 new backend files + 1 regenerated artifact)**

| # | File | Change |
|---|------|--------|
| 1 | `backend/services/billing/subscription-admin.service.ts` | + `listForAdmin(userId, actorId, locale, tx?)` — READ-ONLY: `assertActorAdmin` (defense in depth, joins the caller tx) → strict owner-id validation → `SubscriptionRepository.listByUserId` → `toSubscriptionAdminReturnType` mapping; header docblock gains the "List semantics" paragraph |
| 2 | `backend/services/billing/subscription-admin-read.helpers.ts` | NEW — `coerceUserId(rawId, tErrors)`: strict decimal-string parse for the wire `ID` (canonical form only — rejects `"1e0"` / `"0x1"` / `" 1"` / trailing garbage that `Number()` would lazily accept), positive-safe-integer validation for numeric callers; malformed → one bounded `logDomainError` + localized `ValidationError` (canonical VALIDATION channel, never a 500) |
| 3 | `backend/graphql/query/billing/subscription-admin.query.ts` | NEW — `adminStudentSubscriptions(userId: ID!): [StudentSubscription!]!` with `adminOnlyAuthScopes` + `requireAdminUser`, resolver coerces the wire id via `coerceUserId` then delegates to `SubscriptionAdminService.listForAdmin(coercedUserId, user.id, ctx.locale)`; reuses the single canonical `SubscriptionPothosObject` (`StudentSubscription`); no named exports, side-effect registration |
| 4 | `backend/graphql/query/billing/index.ts` | side-effect import `./subscription-admin.query` + docblock line (per `backend/graphql/query/AGENTS.md` hard rule) |
| 5 | `backend/services/billing/subscription-admin.helpers.ts` | no net change (coerceUserId first landed here, then moved out to the read-helpers sibling after the 300-line counted max-lines ceiling tripped; file back at its committed size) |
| 6 | `backend/services/billing/subscription-admin.service.test.ts` | + `listForAdmin` describe block: 5 tests / 51 expects (see §4) |
| 7 | `frontend/graphql/generated/schema.graphql` | REGENERATED (`bun run generate:gqlSchema`) — +113 lines, additive-only (see §3) |

`frontend/graphql/generated/gql/graphql.ts`: regenerated via `bun codegen` — **byte-identical output** (see §5).

---

## 1. Summary

The admin READ surface completes the five-field admin subscription API. `SubscriptionAdminService.listForAdmin` is a pure read: the defense-in-depth `assertActorAdmin` gate runs BEFORE any read (a non-admin denial costs zero target reads and zero audit rows), the owner id is re-validated through the strict coercion (mirroring `coerceSubscriptionId`'s service-owned-denial style, one strictness notch up per the resolver-guard module's documented wire-id discipline), and the read delegates to `SubscriptionRepository.listByUserId` — whose own `ORDER BY created_at DESC` already provides the newest-first ordering REQ-5.1 asks for (verified at the repo method, now at ~line 328 after Tasks 3-5 grew the file; ordering present, so the service does NOT re-order). The `user_id = requested` WHERE predicate IS the BOLA boundary: a well-formed unknown id returns the indistinguishable empty list. Rows map through the shared `toSubscriptionAdminReturnType` fail-closed enum certification, so the wire carries canonical enum members. The GraphQL field rides the mandatory `adminOnlyAuthScopes` `$all` conjunction (anonymous → UNAUTHORIZED 401, non-admin → FORBIDDEN 403, both pre-resolver) with `requireAdminUser` as the TS-narrowing belt.

Read-only by contract: no writes, no idempotency claims, no audit rows anywhere in the flow.

## 2. Design notes / deviations (recorded for the 5.5-style reviewers)

- **`actorId` parameter added to `listForAdmin`.** plan.md §3.3 sketched `listForAdmin(userId, locale, tx?)` with no actor identity, but plan §5.1's permission matrix mandates the service-side re-assertion ("same — defense in depth") and REQ-7.3 requires `assertActorAdmin` on ANY service path. The gate needs an actor id, so the signature is `listForAdmin(userId, actorId, locale, tx?)` — consistent with the service family's `(target, actorId, locale, tx)` convention. Without it the "non-admin denial zero-touch" test is unimplementable.
- **`tx?: DBTransaction` (not §3.3's `DBQueryExecutor`).** The gate's actor read must join the caller's transaction (the service suite provisions the admin INSIDE `runInRollback`; a standalone gate read cannot see it — first test run proved this with a FORBIDDEN "actor row missing"). `DBTransaction` is assignable to the repo's `DBQueryExecutor` parameter, so `listByUserId` behavior is unchanged, and every sibling method in this service already uses `DBTransaction`.
- **Ordering NOT duplicated service-side**: REQ-5.1's newest-first is satisfied by the repo's `created_at DESC` (pinned by the existing repo suite Tier-1 case and now by the service test).
- **Malformed userId → VALIDATION (not NOT_FOUND)**: the dispatch pins "canonical validation denial"; matches the extend day-count precedent (`tErrors.badRequest`) and `requirePositiveIntId`'s ValidationError channel. A well-formed but nonexistent id is the empty list (disclosure-safe), not an error.
- **coerceUserId lives in a NEW sibling file** (`subscription-admin-read.helpers.ts`) because adding it to `subscription-admin.helpers.ts` tripped oxlint `max-lines` (300 counted). No cross-layer imports: the helper deliberately does NOT import the GraphQL-layer `coerceDecimalSessionId`; it carries the same canonical-decimal regex service-side so the denial (log + localized copy) stays service-owned per REQ-5.3.

## 3. SDL diff verification (schema.graphql, lexicographic diff vs pre-regen snapshot)

**122 diff lines, 9 hunks, 0 deletions, 0 modifications — additions only**, and every addition belongs to the mandated set:

| Kind | Wire name | Verified shape |
|------|-----------|----------------|
| Mutation field | `adminExtendSubscription` | `(input: ExtendSubscriptionInput!): StudentSubscription!` |
| Mutation field | `adminRenewSubscription` | `(input: RenewSubscriptionInput!): StudentSubscription!` |
| Mutation field | `adminCancelSubscription` | `(input: CancelSubscriptionInput!): StudentSubscription!` |
| Mutation field | `adminChangeSubscriptionPlan` | `(input: ChangeSubscriptionPlanInput!): ChangeSubscriptionPlanPayload!` |
| Query field | `adminStudentSubscriptions` | `(userId: ID!): [StudentSubscription!]!` |
| Input | `ExtendSubscriptionInput` | `subscriptionId: ID!, days: Int!` |
| Input | `RenewSubscriptionInput` | `subscriptionId: ID!` |
| Input | `CancelSubscriptionInput` | `subscriptionId: ID!, reason: String` |
| Input | `ChangeSubscriptionPlanInput` | `subscriptionId: ID!, newPlanId: ID!` |
| Payload type | `ChangeSubscriptionPlanPayload` | `subscription: StudentSubscription!, direction: ProrationDirection!, carrySessions: Int!, forfeitedSessions: Int!` |
| Enum | `ProrationDirection` | `Downgrade \| Upgrade` (Pothos key convention) |

Nothing else in the SDL moved — the diff contains ONLY the 5 new fields + 4 input types + payload type + enum, exactly as the task mandates. (Diff saved at `/tmp/sdl-diff.txt`; pre-regen snapshot `/tmp/sdl-before.graphql`.)

## 4. 6.TE — service suite (mandated runner, Postgres 17 up at 127.0.0.1:5432/app_db)

`bun run test/scripts/run-test.ts backend/services/billing/subscription-admin.service.test.ts` → **73 pass / 0 fail (579 expects), run twice, byte-stable** (68 prior extend/renew/cancel/plan-change tests green untouched + 5 new):

1. **newest-first + BOLA**: owner with two rows (createdAt staged −2d/−1d) + a stranger's row → result ids `[newest, oldest]` exactly, stranger's id absent, every row `userId = owner`, statuses as canonical `SubscriptionStatus` members (ReturnType mapping pinned).
2. **unknown-but-well-formed owner id** → `[]` (indistinguishable empty list).
3. **malformed owner id** (`NaN`, `0`, `2.5`, unrolled — no await-in-loop) → `ValidationError`, `extensions.code = "VALIDATION"`, message = localized `badRequest`, byte-identical ×3.
4. **non-admin zero-touch** (student actor) → `FORBIDDEN` + localized forbidden copy, AND `spyOn(SubscriptionRepository, "listByUserId")` asserts the owner-scoped read NEVER RAN (zero-touch), zero audit rows by the actor.
5. **anonymous actor** → `UNAUTHORIZED` + localized unauthorized copy.

Repo suite NOT re-run per task scope: `SubscriptionRepository` gained no code in this task (listByUserId pre-existing, ordering pre-pinned by its own suite).

## 5. Codegen notes (generated files TRACKED, not gitignored)

- `frontend/graphql/generated/schema.graphql` and `frontend/graphql/generated/gql/graphql.ts` are both **git-tracked** (`git check-ignore` empty; both listed by `git ls-files`).
- `bun run generate:gqlSchema` → exit 0, wrote schema.graphql (46,025 bytes) — the +113-line additive diff above.
- `bun codegen` → exit 0. The sole output `frontend/graphql/generated/gql/graphql.ts` is **document-scoped** (`typescript-operations` + `typed-document-node` over `frontend/graphql/sharedDocuments/**` + `frontend/views/**/*.documents.ts`, `ignoreNoDocuments: true`): no frontend document references the new fields yet, so the regenerated file is **byte-identical** (git diff empty). **Carry-forward: Task 10 must re-run `bun run generate:gqlSchema && bun codegen` after adding the admin-subscription documents** — that is when graphql.ts will gain the new operation/field types.

## 6. 6.QL / 6.SEC / 6.SR / 6.IV checklist

- **6.QL**: sub-loop `--lifecycle duplicates` exit 0 on ALL six touched/new files (helpers file failed once on the counted max-lines ceiling → fixed by the sibling-file split; the new helper failed once on `sonarjs/no-nested-conditional` → if/else ladder). Full `bun tsgo` → 0 errors (exit 0, run twice after the last code touch). Full `bun biome:check` → 0 warn (2049 files, no fixes applied).
- **6.SEC**: query gated three-deep — `adminOnlyAuthScopes` (`$all{authenticated, role:[Admin]}`) pre-resolver, `requireAdminUser` belt, `assertActorAdmin` service-side BEFORE any read; BOLA asserted in the service test (only `user_id`-matching rows returned; foreign row absent; spy-proven zero-touch on non-admin denial); malformed id = canonical VALIDATION denial, never a 500; read-only — zero writes, zero claims, zero audit rows.
- **6.SR**: no dead branches (every guard branch test-pinned); no cross-layer imports (service/helper files import nothing from `@/backend/graphql`); enums as values (no runtime status/direction/gateway literals — grep sweep 0 hits); zero plan-artifact references in comments (grep sweep 0 hits); scope check — service + query + barrel + helper + tests + regenerated SDL only (git status = exactly these 7 paths).
- **6.IV**: instruction files read and honored — `backend/graphql/query/AGENTS.md` (side-effect barrel rule, docblock update, regen commands), `backend/graphql/AGENTS.md` (scopes/$all, resolver delegation, DomainError codes, canonical object reuse, enum rule), `backend/services/AGENTS.md` (types from `@/backend/types`, no service `.types.ts`, SSR-safe, tx-last convention), `backend/AGENTS.md` + `.agents/instructions/backend.instructions.md` (schema-generation both-steps rule, no nested ternaries — hit and fixed, taxonomy-only error statuses), plus the sub-loop-printed AGENTS chain for the new helper file.

## 7. Carry-forward for Task 7 (GraphQL integration tests)

- Query field name for the testClient docs: **`adminStudentSubscriptions`**, argument **`userId: ID!`** (a wire STRING), returns `[StudentSubscription!]!` (non-null list of non-null rows, newest first).
- Expected denial matrix on `extensions.code`: anonymous → `UNAUTHORIZED`; student/teacher/parent → `FORBIDDEN`; malformed `userId` (e.g. `"abc"`, `"0"`, `"1e2"`) → `VALIDATION` (message = localized badRequest — the wire string is decimal-coerced BEFORE the service, so `" 1"`/`"1e2"`-style values deny rather than silently re-target); well-formed unknown id → SUCCESS with `[]` (not an error).
- Mutation replay legs already pinned: renew replay = success with the FIRST result; plan-change replay = success with zeros on carry/forfeit.
- SDL + codegen are current as of this task; Task 10 re-runs codegen after documents land.

## 8. Sandbox notes

- The main↔feat HEAD-flip automation stayed neutralized: the first edit touched a feat-only tracked file, which makes every later flip abort-on-dirty, pinning the tree to `feat/admin-subscription-management` for the rest of the session (checkout discipline prefix still issued on every Bash call).
- Generated artifacts are tracked; the working tree after this task carries exactly 4 modified tracked files + 2 untracked new backend files + this outcome file/tasks.md/worklog plan-artifact updates (uncommitted, per the no-commit discipline).
