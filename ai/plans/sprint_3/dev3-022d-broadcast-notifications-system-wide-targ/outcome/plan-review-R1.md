# Plan Review R1 — DEV3-022d Broadcast Notifications (Phase 1.5 gate)

**Plan bundle:** `ai/plans/sprint_3/dev3-022d-broadcast-notifications-system-wide-targ/` (plan.md, specs.md, tasks.md, deferred-items.md, prototype/ 5 PNGs)
**Reviewer:** Plan Review Executor (Task ID 1.5) — READ-ONLY against production code; this outcome file is the only write.
**Skill:** `.agents/skills/plan-review/SKILL.md` (5-step workflow: read plan → map layers → read layer AGENTS.md → check rules → report).

---

## Verdict: **PASS-with-notes**

The plan is architecturally compliant on every cross-cutting dimension (types, service boundaries, MUI v9, i18n, logging, test conventions, GraphQL documents) and its substrate citations are overwhelmingly accurate (schema anchors, context-factory anchors, error-ctor overloads, enum/guard line ranges all verified EXACT). One task (2.2) is built on a stale premise — the shared `assertActorAdmin` extraction it plans to perform **already exists** in the tree — and two substrate file paths are missing a directory segment. All three are text-level corrections to the plan bundle; none changes the architecture. Apply the corrections (gate notes below) before the affected phases execute.

| Severity | Count |
|---|---|
| Blocking (must re-scope before execution) | 1 |
| Medium (wrong substrate path — task fails on first edit) | 2 |
| Low (wording/mechanism/naming inconsistencies) | 3 |
| Informational notes | 4 |

---

## Findings

### F-1 — BLOCKING — task 2.2 / plan §4.3 / REQ-030 (D8): the shared `assertActorAdmin` extraction ALREADY shipped

[backend/services] task 2.2 (tasks.md) + plan §4.3: create shared admin gate by extracting a private copy
  → Expected: "ONE canonical admin-actor gate … no forked copies remain" (plan's own D8; `backend/services/AGENTS.md` duplication rules)
  → Plan has: "CREATE `backend/services/admin/assert-actor-admin.ts` — move the logic from `backend/services/admin/user-management.service.ts:240-271` VERBATIM … UPDATE `user-management.service.ts` — delete the private copy. UPDATE `backend/services/admin/index.ts` — export the helper."
  → Reality (verified): the extraction is ALREADY DONE, in a differently-named file. `backend/services/admin/admin-gate.helpers.ts:59` exports `assertActorAdmin(actorId: number, locale: string, outerTx?: DBTransaction): Promise<void>` with exactly the planned semantics (ANONYMOUS_ACTOR_ID=0 → `UnauthorizedError`; missing/non-admin row → `ForbiddenError`; pre-transaction; zero writes/audit; `logger.logDomainError`). It is re-exported via `backend/services/admin/index.ts`; `user-management.service.ts` imports it (`:65`) and calls it at 9 sites — there is NO private copy to delete (its `:240-271` span is `createUser`, which CALLS the gate at `:271`). `backend/services/AGENTS.md:10` already documents `admin-gate.helpers.ts` as the shared gate; the DEV3-016 chaos/service suites already lock it.
  → Required re-scope (before Phase 2.2): task 2.2 becomes "consume `assertActorAdmin` from `@/backend/services/admin/admin-gate.helpers` in `AdminBroadcastService.broadcast` step 1" — drop the CREATE/rename and the "delete the private copy" step (or reduce to a no-op rename/re-export only if the name `assert-actor-admin.ts` is contractually required, which nothing mandates). Keep the "run all existing admin suites — behavior unchanged" regression step as a cheap no-op verification. Executing 2.2 verbatim would fork the admin gate — a worse outcome than the drift itself.
  → Contract nuance to carry into task 2.4: the shared gate logs `entity: "user"`. REQ-034's broadcast log context (`entity: "notifications" | "plans"`) applies to the broadcast service's OWN `logDomainError` calls (validation/cohort guards), not to the reused gate.

### F-2 — MEDIUM — task 4.4 / REQ-064 / plan §5.2: navItems path is missing the `nav/` segment

[frontend/views] task 4.4 / plan §5.2: update admin nav file
  → Expected: substrate file exists at the cited path
  → Plan has: `frontend/views/dashboard/navItems.ts` (`:126-135`) — that path DOES NOT EXIST.
  → Reality: the file is `frontend/views/dashboard/nav/navItems.ts` (companion test `frontend/views/dashboard/nav/navItems.test.ts`). The admin list `[UserRole.Admin]` is at `:126-135` — the LINE NUMBERS match exactly, and the content matches the plan's verified-absence claim (dashboard/notifications/users/teachers/students/plans/audit/profile; no broadcasts entry; no ComingSoon nav entry). Fix the path in tasks.md 4.4 (including its `sub-loop.ts --lifecycle duplicates` QL command) and plan §5.2 before Phase 4.4.

### F-3 — MEDIUM — task 4.1 / plan §5.4 (REQ-023 client half): `createAuthLink` lives in `utils/link-factories.ts`

[frontend/providers] task 4.1: update Apollo authLink module
  → Expected: `frontend/providers/apollo/utils.ts`
  → Plan has: that file DOES NOT EXIST.
  → Reality: `createAuthLink` is exported from `frontend/providers/apollo/utils/link-factories.ts:19` (`utils/` is a sub-directory with its own `index.ts` barrel, per root AGENTS.md nested-barrel rules). Fix the UPDATE path and the 4.1 QL command before Phase 4.1. The additive context-header merge design itself is fine and lands in `createAuthLink` there.

### F-4 — LOW — task 2.0: internal contradiction about `test/workflows/AGENTS.md`

[test/workflows] task 2.0 applicable-instructions line
  → Expected: consistent guidance about the journey layer
  → Plan has: "The layer already exists — REUSE it: `test/workflows/AGENTS.md` + …" AND "`test/workflows/AGENTS.md` (created by this task)".
  → Reality: `test/workflows/AGENTS.md` EXISTS (100 lines: NO-`runInRollback` rule, TrackedFixtures committed-fixture contract, actor-context factory, SpiedFanoutTransport, `helpers.self-test.test.ts`), and it declares the harness scaffolded with domain subdirectories landing "with their owning tickets". The "(created by this task)" parenthetical is stale — the task only ADDS `test/workflows/notifications/admin-broadcast.journey.test.ts` plus the governed (`is_deleted`) fixture. Fix the wording.

### F-5 — LOW — task 3.2 / plan §3.3 / REQ-062: mutation-freeze mechanism description is inaccurate (enumerated edits remain correct)

[backend/graphql/test] `backend/graphql/test/schema-surface.test.ts`
  → Expected: accurate description of the baseline freeze so the implementer edits the right constant
  → Plan has: "`PRE_3_1_MUTATION_FIELDS` unchanged (its additions block already tolerates growth only via the named additions assertion — EXTEND that list with the new mutation name …)".
  → Reality: the mutation-freeze test (`:277-283`) is a HARD `toEqual` against `PRE_3_1_MUTATION_FIELDS` — there is NO additions block for mutations (the `additions` array at `:301+` exists only for named TYPE names). `adminBroadcastNotification` must be INSERTED INTO `PRE_3_1_MUTATION_FIELDS` (defined at `:106`; alphabetically first, as the plan says for `FROZEN_MUTATION_FIELDS` in `sdl-static-assertions.test.ts:72` — that constant verified too). The rest of the plan's freeze plan is self-consistent: `PRE_3_1_ENUMS` (`:122`, hard equality `:291`) gains `"BroadcastAudienceType"` exactly as planned, and adding the three new type names to `PRE_3_1_TYPE_NAMES` (`:134`) keeps the `:301` additions array untouched. Bottom-line file edits are right; only the parenthetical explanation is wrong.

### F-6 — LOW — REQ-001 vs task 0.1 outcome-file name mismatch

[outcome protocol] specs.md REQ-001 vs tasks.md task 0.1
  → Expected: one canonical outcome filename
  → Plan has: REQ-001 says `outcome/0-baseline-outcome.md`; task 0.1 says `outcome/0.1-baseline-outcome.md` (and REQ-082's rule is `outcome/<task-id>-outcome.md`, which matches the task-0.1 spelling).
  → Resolution: use `0.1-baseline-outcome.md` (task-id rule wins); treat REQ-001's filename as a typo. No plan redesign needed.

### Informational notes (no action beyond awareness)

- **N-1 Line-anchor drift (already ledgered):** tasks.md/plan.md hint `emitForUsers` `notification-engine.service.ts:393` (actual `:80`), `publishReceipts` `:475` (actual `:117`), `assertActorAdmin` `user-management.service.ts:240-271` (actual `admin-gate.helpers.ts:59`), active-subscription predicate `admin-user.repository.ts:337-346` (actual `studentHasActiveSubscriptionSubquery()` at `backend/db/repo/admin/admin-user-query-helpers.ts:134-143`). Every symbol EXISTS. `outcome/0.2-prerequisites-outcome.md` already records the corrected anchors — downstream tasks must cite those, per REQ-002's own protocol.
- **N-2 `RedisFanoutClientLike` does not exist** anywhere in the tree (plan §4.2 constructor param). The existing Redis port is `RedisFanoutClient` (`backend/services/notifications/realtime/redis-pubsub-transport.ts` — pub/sub-shaped) wrapped by `IoredisFanoutClient` (`ioredis-fanout-client.ts`, `Redis` from ioredis, `lazyConnect: true`). `RedisClaimCache` should accept the ioredis `Redis` type or a minimal local `{ get, set, … }` interface — do not import a nonexistent name. Also read `REDIS_URL` through the registered env seam (`getRedisUrl()` from `@/backend/lib/env`, the pattern `resolveFanoutTransport` uses — that anchor, `fanout-transport.factory.ts:44`, verified EXACT).
- **N-3 Skill/root-doc stale logger path (plan is correct):** the plan-review skill and root AGENTS.md cite `@/frontend/utils/logger` — that path does not exist; the real frontend logger is `frontend/lib/logger.ts` (`@/frontend/lib/logger`). Task 4.3.SR already cites the correct module. Backend side `@/backend/lib/logger` verified.
- **N-4 Bare `Int!` mutation payload vs the `id`-field rule:** `adminBroadcastNotificationMutationDocument` selects only the scalar count — `frontend/graphql/sharedDocuments/AGENTS.md`'s "always include `id`" rule applies to named object selections (cache normalization); a scalar payload has nothing to normalize, so the bare selection is compliant. No new object/embedded type is introduced, so the `apolloCache.ts` `keyFields: false` policy is not triggered.

---

## Cross-cutting dimension check (skill Step 4) — all verified in-plan

| Dimension | Verdict | Evidence |
|---|---|---|
| Type imports | ✅ compliant | All new shapes in `backend/types/notifications/broadcast.types.ts` (+ barrel update); NO local types in Pothos files (inputs registered via `inputType`, the sanctioned input exception in `backend/graphql/AGENTS.md`); `AuditLogWriteContract.entityId` widening rides `AuditLogSelectType["entityId"]` (schema-derived) — current contract verified `number` at `backend/types/contracts/admin-audit.contract.types.ts:27`; no service-layer `.types.ts` planned. `DBTransaction`/`DBQueryExecutor` from `@/backend/types`. |
| Service boundaries | ✅ compliant | Server Component page (`app/(dashboard)/admin/broadcasts/page.tsx`) uses `withPageAuth` + renders client container — mirrors the shipped `app/(dashboard)/admin/users/page.tsx` / `/admin/plans` pattern; `withPageAuth` verified at `frontend/lib/auth/withPageAuth.ts:67` (the app/AGENTS.md `app/(dashboard)/shared/withPageAuth.ts` pointer is the stale one — plan cites the real file). Client container uses `useMutation`/`useQuery` only; resolvers delegate exclusively to `AdminBroadcastService`; no resolver→repo/engine calls. |
| MUI v9 | ✅ compliant | sx-only + `theme.palette.*`, `*Outlined` icons (`CampaignOutlined`, `SendOutlined`), `focusVisibleRingSx`, ≥44px targets, `Box component="output" aria-busy` (matches frontend/AGENTS.md `prefer-tag-over-role` pattern), `React.SubmitEvent` (no `FormEvent`), logical RTL spacing. |
| i18n | ✅ compliant | New `AdminBroadcasts` namespace registered per the `shared/AGENTS.md` checklist (types + ar + en + `Translations` entry — interface verified at `shared/locale/types/message.ts:13` — both `messages.ts` bundles + registry + dedicated parity test modeled on the verified `notifications-namespace.parity.test.ts`); plural `successToast(count)` matches the `notificationsAr.markAllResult` precedent (verified `shared/locale/ar/notifications/index.ts:23`); 4 new errors keys are flat + domain-prefixed, matching the verified `ErrorsLabels` shape (`shared/locale/types/errors/index.ts` — flat keys + sanctioned `planCatalog`/`adminUsers` groups; `planNotFound` verified at `en/errors/index.ts:23`); resolver `ctx.t("errorsTranslations")`; server `getTranslations(locale)` single-arg; `dir="auto"` for verbatim copy. No hardcoded text planned. |
| Logging | ✅ compliant | Zero `console.*` (gateway static-assertion A3 explicitly extended to new modules — scanner verified at `backend/lib/gateway/static-assertions.test.ts:102`); `logger` from `@/backend/lib/logger` / `@/frontend/lib/logger`; `logDomainError` with metadata-only context (no recipient lists, no raw keys). |
| Test conventions | ✅ compliant | Repo/service tests: `runInRollback`, `tx` propagation, `expectRepoError` try/catch (no `.rejects.toThrow()`), entity-setup helpers, 100% coverage gate. Journey test: committed fixtures + `TrackedFixtures` reverse-order hard-delete + `withAuditDeleteTriggersSuspended` (verified `test/helpers/db-cleanup.ts:83`) + `SpiedFanoutTransport` (verified `test/workflows/helpers/spied-transport.ts:49`) + scripted claim cache — NO `runInRollback`, per `test/workflows/AGENTS.md` hard rule 1. All execution via `bun run test/scripts/run-test.ts` (never raw `bun test`). |
| GraphQL documents | ✅ compliant | `adminBroadcastNotificationMutationDocument: TypedDocumentNode<AdminBroadcastNotificationMutation, AdminBroadcastNotificationMutationVariables>` — exact sharedDocuments naming convention; barrel-wired under `frontend/graphql/sharedDocuments/notifications/` (barrel + `notification.documents.ts`/`.test.ts` precedent verified); hooks from `@apollo/client/react`; NO `useLazyQuery`; `gql`/`TypedDocumentNode` from `@apollo/client`; codegen artifacts (`frontend/graphql/generated/gql/graphql.ts`, `schema.graphql` — both exist) committed in-set. |
| Pothos registration | ✅ compliant | Enum defined in `backend/enum/notifications/broadcast-audience-type.enum.ts` + barrel + guard (mirrors verified `notification-type.enum.ts:5-13` members / `:21-23` guard); registered ONCE in `backend/graphql/pothos/shared/enum.pothos.ts` (exists) in enum-OBJECT form (literal `values:[...]` fails verified gate A2 at `backend/lib/gateway/static-assertions.test.ts:97`); mutation side-effect barrel pattern matches `backend/graphql/mutation/AGENTS.md` and the verified `mutation/notifications/index.ts`; public-operations allowlist untouched (admin op). |
| Substrate existence (REQ-002 spot-check) | ✅ verified | All 16 artifacts present — independently re-verified here AND recorded in `outcome/0.2-prerequisites-outcome.md`: engine primitives, `NotificationRepository.createManyReturning` (`notification.repository.ts:148` exact), `AuditService.createAuditLog` (`audit.service.ts:82`), `PlanRepository.existsById` (`plan.repository.ts:109` exact), `toUserRole` (`user-role.enum.ts:24` exact), `ValidationError(code, message)` overload (`backend/lib/errors.ts:78-79`), `gqlContextFactory.ts:72/:181` idempotency capture (EXACT), `adminPlansQueryDocument`, `projectMutationFieldErrors` (`mutationFieldErrors.ts:125`), `withPageAuth`, test-workflows helpers. Schema anchors EXACT: `enums.ts:61` `system_broadcast` (no pgEnum change — REQ-044 holds), `audit-logs.ts:39` nullable `entityId`, `notifications.ts:27`, `subscriptions.ts:19`, `users.ts:11`. |
| Tasks hygiene | ✅ verified | 104 `[ ]` checkboxes, 0 stale `[-]` markers, the only `[x]` occurrences are protocol prose (lines 18, 297). Journey filename `test/workflows/notifications/admin-broadcast.journey.test.ts` matches the `admin-*.journey.test.ts` convention (`test/workflows/admin/` precedent) and collides with nothing in the existing `test/workflows/notifications/` (j1/j2 files). |

---

## AGENTS.md / instruction files consulted (skill Step 3)

**Exist and were read in full (16):**
1. `AGENTS.md` (root)
2. `backend/AGENTS.md`
3. `backend/services/AGENTS.md`
4. `backend/graphql/AGENTS.md`
5. `backend/graphql/mutation/AGENTS.md`
6. `backend/graphql/pothos/AGENTS.md`
7. `backend/db/repo/AGENTS.md`
8. `backend/types/AGENTS.md`
9. `backend/enum/AGENTS.md`
10. `frontend/AGENTS.md`
11. `frontend/graphql/AGENTS.md`
12. `frontend/graphql/sharedDocuments/AGENTS.md`
13. `app/AGENTS.md`
14. `shared/AGENTS.md`
15. `shared/locale/AGENTS.md` (i18n layer the plan touches)
16. `test/workflows/AGENTS.md` (journey layer the plan touches)

**Instruction files (`.agents/instructions/`, all exist, read in full):** `backend.instructions.md`, `frontend.instructions.md`, `tests.instructions.md`.

**Verified NOT to exist (never cited as authority; plan task 4.3 already self-flags the first two):**
- `frontend/views/AGENTS.md`
- `frontend/components/ui/AGENTS.md`
- `backend/services/notifications/AGENTS.md` (task 2.4 says "if present" — it is not)
- `.github/instructions/` directory (root AGENTS.md's pointer is stale; the instruction files live at `.agents/instructions/`)

---

## Gate notes for the orchestrator

1. **Apply three text corrections to the plan bundle before the affected phases:** (a) re-scope task 2.2 per F-1 (consume `admin-gate.helpers.ts#assertActorAdmin`; do NOT create a second shared helper; there is no private copy to delete); (b) fix task 4.4 / plan §5.2 path to `frontend/views/dashboard/nav/navItems.ts` (F-2); (c) fix task 4.1 / plan §5.4 path to `frontend/providers/apollo/utils/link-factories.ts` (F-3). All are plan-text edits — zero architecture change, zero re-estimation.
2. **Execution status observed at review time:** `outcome/0.2-prerequisites-outcome.md` already exists (task 0.2 COMPLETE — all 16 substrate artifacts ✅, drift advisory recorded). Task 0.1 is still pending: `deferred-items.md` is the unseeded template (no D1/D2 rows yet) and no baseline outcome file exists — D1/D2 ledger seeding (REQ-076's final gate greps for it) rides on 0.1.
3. **Downstream anchor discipline:** tasks must cite the corrected anchors from `outcome/0.2-prerequisites-outcome.md` (N-1), not the stale tasks.md line hints.
4. **Watch-items carried into implementation:** use `getRedisUrl()` env seam for `resolveBroadcastClaimCache()` and don't import the nonexistent `RedisFanoutClientLike` (N-2); mutation freeze is a hard equality — insert the new mutation INTO `PRE_3_1_MUTATION_FIELDS` (F-5); the shared gate logs `entity: "user"` — broadcast-service logging context rules (REQ-034) apply to the service's own calls (F-1 nuance).
5. No blocker prevents Phase 0/1 from proceeding in parallel with the plan-text corrections; Phase 2.2 / 4.1 / 4.4 must not start until their corrections land.
