# Task 6 Outcome — `changeMyPassword` mutation + `ChangeMyPasswordInput` + codegen + wire test

> **Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
> **Task:** `6. changeMyPassword mutation + ChangeMyPasswordInput + codegen (D5, REQ-006)` (Phase 3 — GraphQL Surface)
> **Date:** 2026-09-30 · **Agent:** general-purpose subagent · **Repo root:** `/home/z/my-project` (plan docs cite `/home/ahmed/Projects/kottaby_kottaby/`; all paths resolve 1:1 relative to the repo root)
> **Result:** 1 new self-service mutation field + 1 new closed input wired to the Task-4 service; codegen pipeline clean; auth wire suite **14 pass / 0 fail / 48 expect()** (10 pre-existing + 4 new); schema-surface suite **101 pass / 0 fail / 645 expect()** (96 pre-existing + 5 new SDL pins, incl. 3 PRE-EXISTING failures inherited from Task 5's stale surface-freeze pins — now re-anchored, see §2/§7); sub-loop exit 0 on all 4 touched files; full-repo `bun tsgo` **0 errors / exit 0**. No commits made.

## 1. What Was Implemented

### 1.1 Closed input — `ChangeMyPasswordInput` (`backend/graphql/pothos/users/user.pothos.ts`)

New `gqlSchemaBuilder.inputType("ChangeMyPasswordInput", …)` appended after the (byte-untouched above it) canonical `UserPothosObject` — mirroring Task 5's placement convention (the domain input lives in the domain pothos file beside the canonical object; `updateMyLocale` itself has no input type — its arg is the shared `AppLocalePothosEnum` — so the users-domain input home is `user.pothos.ts`, which is also where `user.mutation.ts` already imports `UserPothosObject` from):

```typescript
export const ChangeMyPasswordInput = gqlSchemaBuilder.inputType("ChangeMyPasswordInput", {
  fields: t => ({
    currentPassword: t.string({ required: true }),
    newPassword: t.string({ required: true }),
  }),
});
```

EXACTLY two required members; `passwordHash`, identity, the locale preference, and every governance field (incl. `mustChangePassword` itself) are structurally unreachable through the shape. JSDoc documents the closed discipline, the BOPLA no-identity-member rule (identity is always `ctx.user.id`), and the plaintext lifetime (verified/hashed by the service before persistence; never stored/logged/audited/echoed). Auto-flows to `user.mutation.ts` via the existing direct module import path — zero barrel edits (the users domain registers transitively through its resolvers per `pothos/index.ts`).

### 1.2 Mutation — `changeMyPassword` (`backend/graphql/mutation/user.mutation.ts`)

Registered as a side-effect `gqlSchemaBuilder.mutationField(...)` immediately after the byte-untouched `updateMyLocale` block, mirroring the file's established shapes exactly:

- `args: { input: t.arg({ type: ChangeMyPasswordInput, required: true }) }` — the single closed input argument (task-text shape verbatim).
- `authScopes: { authenticated: true }` — the `me`/`updateMyLocale` precedent; every authenticated role owns its own credential, so NO role/permission/superAdmin material participates. Anonymous → `UNAUTHORIZED` at the scope layer, before the resolver body.
- Returns the canonical `UserPothosObject` (`me`/`login`/`updateMyLocale` return object) — the `mustChangePassword: false` echo needs zero extra work (Task 5 already wired the field).
- Resolver = the `updateMyLocale` TypeScript-narrowing prelude (`if (!ctx.user)` → `UnauthorizedError(tErrors.unauthorized)` via `await ctx.t("errorsTranslations")` — the per-resolver i18n rule) → **BOPLA property mapping** into the service's closed submit input → delegation:

```typescript
return AuthService.changeMyPassword(
  ctx.user.id,
  { currentPassword: args.input.currentPassword, newPassword: args.input.newPassword },
  ctx.locale
);
```

ZERO business logic in the resolver — current-password verification, the same-as-current guard, the shared policy gate, hashing, the single flag-clearing write, and the password-stripped projection all live in `AuthService.changeMyPassword` (Task 4's §5 carry-forward signature: `(userId, input: ChangeMyPasswordSubmitInput, locale, outerTx?)`; the optional `outerTx` is correctly OMITTED — production resolver path). The only errors constructed here come from `@/backend/lib/errors` (`UnauthorizedError`). Header docblock updated: title now enumerates both mutations, the contract list gained the `changeMyPassword(input: ChangeMyPasswordInput!): User!` SDL line, and the scope/thin-resolver sections cover both fields. Barrel wiring unchanged: `mutation/index.ts` side-effect-imports the file.

### 1.3 Codegen pipeline (generated artifacts, via the commands ONLY)

```
bun run generate:gqlSchema   → wrote frontend/graphql/generated/schema.graphql (62395 bytes) — exit 0
bun codegen                  → ✔ Generate to ./frontend/graphql/generated/gql/graphql.ts — exit 0
```

**Verified in the generated SDL** (`frontend/graphql/generated/schema.graphql`, lexicographically sorted; this task's delta = exactly 6 lines — `ChangeMyPasswordInput` + `changeMyPassword` — on top of Task 5's uncommitted 8):

```graphql
input ChangeMyPasswordInput {
  currentPassword: String!
  newPassword: String!
}

type Mutation {
  # …existing fields…
  changeMyPassword(input: ChangeMyPasswordInput!): User!
}
```

Exactly the plan §4.1 self-service half. **Honest note on `graphql.ts`:** the typed-operations output is UNCHANGED by this task (`git diff --stat` empty) — `codegen.ts documents` scans only `sharedDocuments/**` + `views/**/*.documents.ts`, and no scanned document references the new surface until the shared `changeMyPasswordMutationDocument` lands (Task 9's document deliverable; same mechanism that kept `AdminSetUserPasswordMutation` out in Task 5). The generated file was never hand-edited. `bun tsgo` 0 confirms nothing downstream broke.

### 1.4 Wire test extension (`frontend/graphql/test/auth/auth.test.ts`, +4 tests)

**Home choice (documented per the task brief):** the auth wire suite `frontend/graphql/test/auth/auth.test.ts` — the existing integration suite that already covers the sibling self-scoped auth operations (`registerUser`, `login`, `me`, `refreshToken`, `logout`) against the live server + dev DB, using the same `Authorization: Bearer` header pattern. A `backend/graphql/test/` focused case was NOT chosen because that directory's conventions are in-process SDL/static assertions (e.g. `schema-surface.test.ts`), while the three required proofs (happy-path flag echo, anonymous rejection, wrong-current denial) are behavior-on-the-wire assertions this suite already owns. The SDL-side shape/scope/anonymous pins ARE additionally covered by 5 new in-process tests in `schema-surface.test.ts` (§1.5) — the two layers stay consistent with repo conventions.

- **Probe document:** a locally `parse`d `TypedDocumentNode` (`parse` from `graphql`, the `admin-users.integration.test.ts` Task-5 precedent) with a local wire interface selecting `id email fullName role mustChangePassword` — the shared auth documents barrel carries only production-UI operations and the shared `changeMyPasswordMutationDocument` is the document-task deliverable, so the wire shape is pinned locally for now (swappable later under the single-source discipline). Mutation-argument-coverage rule satisfied: the input has exactly two REQUIRED fields, both always passed — no optional fields exist.
- **Placement rationale (commented in the test):** the block runs AFTER the `logout` probe so the credential rotation can never disturb the earlier `login`/`me`/`refreshToken` assertions — the access token minted mid-suite stays valid (stateless JWT; no session store to revoke), cookie-based logout does not affect `Authorization`-header probes, and the suite's `afterAll` hygiene deletes the registered user exactly as before (the rotation creates no rows and no users).

| Test | Asserts |
|---|---|
| `changeMyPassword — without auth returns UNAUTHORIZED` | scope-layer denial with no headers |
| `changeMyPassword — wrong current password denies with the CURRENT_PASSWORD_INVALID field code and zero writes` | `extensions.code === "CURRENT_PASSWORD_INVALID"` (the custom DomainError code rides the wire verbatim); `extensions.fields` = EXACTLY one entry `{ field: "currentPassword", code: "CURRENT_PASSWORD_INVALID", message }`; zero-write proof at the wire tier — the ORIGINAL credential still authorizes `login` after the denial |
| `changeMyPassword — happy path returns mustChangePassword: false and NO passwordHash anywhere` | error-free; canonical payload echoes `id`/`email`/`role` + `mustChangePassword === false`; `deepFindKey(result.data, "passwordHash") === false` (deep key-walk over the whole response — the admin-suite helper pattern, local mirror with the oxlint no-unsafe-assertion rationale) |
| `changeMyPassword — the rotation persists: old credential denied, new one authorizes` | `login` with the OLD credential → `UNAUTHORIZED`; `login` with the NEW credential → success + correct user (pure-GraphQL persistence proof — no backend imports per the integration-test layer-separation rule) |

Helpers: reused `expectMutationError` / `extractErrorCode` from `@/test/helpers` (the canonical failure-side assertion helper); new module-scope `deepFindKey` (local mirror of the admin-suite walker — suites are independent processes); new `rotatedCredential` constant named WITHOUT the literal `password` token (`sonarjs/no-hardcoded-passwords` convention, value satisfies the shared ≥8-char policy).

### 1.5 SDL pins (`backend/graphql/test/schema-surface.test.ts`, +5 tests + pin refresh)

New describe `Users self-service credential surface — changeMyPassword SDL pins` (modeled 1:1 on the `Users-locale surface` block): the field returns `User!` with EXACTLY ONE required `input: ChangeMyPasswordInput!` arg; carries EXACTLY the `authenticated` scope (explicit `role`/`permission`/`superAdmin` absences); `ChangeMyPasswordInput` discloses EXACTLY the two required `String!` members (`GraphQLInputObjectType` introspection — closed-shape pin); anonymous in-process execution yields `UNAUTHORIZED` at path `["changeMyPassword"]`; a smuggled `userId` argument dies at validation (`Unknown argument "userId"`) before any resolver runs — the BOLA zero-identity-arg pin.

**⚠️ Pin refresh (see §7):** the suite's Surface-freeze pins were ALREADY failing (3 tests) before this task — Task 5's `adminSetUserPassword` was never registered in them. Per the pin-refresh rule ("a stale pin asserts a false contract and hides real drift"), the same change re-anchored: `ADMIN_USER_USER_MUTATION_FIELDS` trio → quartet (+`adminSetUserPassword`), the contiguity pin 19 → 20 (sorted: …adminSetUserDeleted < **adminSetUserPassword** < adminSetUserSuspended…), new `SELF_SERVICE_CREDENTIAL_MUTATION_FIELDS = ["changeMyPassword"]`, new `CREDENTIAL_INPUT_TYPE_NAMES = ["AdminSetUserPasswordInput", "ChangeMyPasswordInput"]`, titles/comments updated.

## 2. Files Modified / NOT Modified

| File | Change |
|---|---|
| `backend/graphql/pothos/users/user.pothos.ts` | +`ChangeMyPasswordInput` closed input (+JSDoc) appended after `UserPothosObject`. Object block byte-identical. |
| `backend/graphql/mutation/user.mutation.ts` | +`ChangeMyPasswordInput` import; header docblock (both-mutation enumeration + SDL contract line + scope/thin-resolver sections); +`changeMyPassword` mutation field. `updateMyLocale` block byte-identical. |
| `frontend/graphql/generated/schema.graphql` | +6 lines — GENERATED by `bun run generate:gqlSchema` (never hand-edited). |
| `frontend/graphql/test/auth/auth.test.ts` | +4 tests; +`parse`/`TypedDocumentNode`/`expectMutationError` imports; +probe wire interface + locally-parsed document; +`rotatedCredential` constant; +local `deepFindKey`. Pre-existing 10 tests byte-identical. |
| `backend/graphql/test/schema-surface.test.ts` | +5 SDL-pin tests (new describe); Surface-freeze pin refresh (constants + titles + comments) — re-anchors Task 5's `adminSetUserPassword` AND registers `changeMyPassword`/`ChangeMyPasswordInput`. |
| `ai/plans/…/outcome/6-outcome.md` | This file (new). |
| `ai/plans/…/tasks.md` | Task 6 main line + `6.QL/6.TE/6.SEC/6.SR/6.IV` flipped only. |
| `worklog.md` | Appended Task 6 record. |

**Files NOT modified (and why):** `backend/services/auth/auth.service.ts` + `backend/types/users/auth.types.ts` (Task 4's `changeMyPassword`/`ChangeMyPasswordSubmitInput` consumed as-is — the resolver maps onto the exact carry-forward signature), `backend/graphql/pothos/admin/**` + `mutation/admin/**` (Task 5 surface, consumed as-is; only its stale test pin was re-anchored), `frontend/graphql/generated/gql/graphql.ts` (codegen ran; output unchanged because no scanned document references the new surface until the shared document task — hand-editing generated output is prohibited), `frontend/graphql/sharedDocuments/auth/auth.documents.ts` (shared `changeMyPasswordMutationDocument` belongs to the document task), `apollo-server.ts`/op-guard (Task 7 — `changeMyPassword` will be ON its closed allowlist), `public-operations.ts` (the mutation is authenticated-only — no anonymous-allowlist entry needed or made), shared/locale/** (Task 8 keys already shipped), audit-census catalog (n/a — self-service is deliberately UNAUDITED per the plan's side-effect matrix; the census bijection covers admin mutations only), no barrels edited (auto-flow).

## 3. Verification Results

### 3.1 6.TE — suites + codegen

- `bun run test/scripts/run-test.ts frontend/graphql/test/auth/auth.test.ts` → **14 pass / 0 fail / 48 expect() / ~12.7s** (10 pre-existing + 4 new, green after the server booted; two environment-only retries — a stale orphaned `next-server` from a previous session held port 3066 and Next's dev lockfile in `.next-test-dev/dev/lock` pinned the dead PID; killed the orphan + removed the stale lock, suite then green. NO code change was involved in either retry).
- `bun run test/scripts/run-test.ts backend/graphql/test/schema-surface.test.ts` → **101 pass / 0 fail / 645 expect()** (96 pre-existing incl. the 3 that were failing BEFORE this task due to Task 5's unregistered surface + 5 new; the Codegen-sync pin also re-proves the committed SDL is byte-identical to a fresh deterministic emission).
- Codegen pipeline exit 0 both steps with the SDL verified §1.3; input exactly 2 fields (SDL is the proof); codegen types resolve (`bun tsgo` 0).

### 3.2 6.QL — sub-loop `--lifecycle duplicates` (tsgo → oxlint → biome → lint:type-aware → check:duplicates)

| File | Exit | Log |
|---|---|---|
| `backend/graphql/mutation/user.mutation.ts` | **0** (5/5 stages) | `/tmp/subloop-t6-mutation.log` |
| `backend/graphql/pothos/users/user.pothos.ts` | **0** (5/5 stages) | `/tmp/subloop-t6-userpothos.log` |
| `frontend/graphql/test/auth/auth.test.ts` | **0** (5/5 stages) | `/tmp/subloop-t6-authtest.log` |
| `backend/graphql/test/schema-surface.test.ts` | **0** (5/5 stages) | `/tmp/subloop-t6-surfacetest.log` |

### 3.3 Type check

Full-repo `bun tsgo` → **0 "error TS" lines, tool exit 0** — zero NEW errors vs the Task-0 baseline.

## 4. Subtask Pipeline

- **6.QL** ✅ — §3.2: 4/4 files exit 0 (all five stages each).
- **6.TE** ✅ — codegen resolves (both commands exit 0; SDL §1.3 verified; `graphql.ts` unchanged by design); wire test green via run-test (auth suite 14/0/48; surface suite 101/0/645).
- **6.SEC** ✅ — the response is password-stripped by construction (`RegistrationReturnType` = `Omit<UserSelectType, "passwordHash">`) and the wire suite deep-walks `passwordHash` across the ENTIRE happy-path response; the `authenticated` scope rejects anonymous callers BOTH on the live wire (UNAUTHORIZED probe) and in-process (SDL pin asserting `extensions.code === "UNAUTHORIZED"` at path `["changeMyPassword"]`); the closed two-member input + zero-identity-arg validation pin (smuggled `userId` dies before any resolver) closes the mass-assignment/BOLA surface; the zero-write denial proof (original credential still logs in) confirms a rejected attempt persists nothing.
- **6.SR** ✅ — the resolver delegates to `AuthService.changeMyPassword` with ZERO business logic (no verification/policy/hash/persist code outside the service); errors come exclusively from `@/backend/lib/errors` (`UnauthorizedError` prelude; service-owned `ValidationError`s pass through the DomainError boundary); `ctx.t("errorsTranslations")` used for the prelude message per the resolver-i18n rule; `ctx.locale` propagated; identity is `ctx.user.id` only (no target argument exists); no local type defs in Pothos (the only new shape is the sanctioned GraphQL input type); generated files touched ONLY by the two codegen commands.
- **6.IV** ✅ — read in full BEFORE editing: `backend/graphql/AGENTS.md`, `backend/AGENTS.md`, root `AGENTS.md`, `.agents/instructions/backend.instructions.md`, `.agents/instructions/tests.instructions.md`; also consulted `frontend/graphql/test/AGENTS.md` for the wire-suite conventions. Every honored rule of note: thin resolvers + `ctx.locale` propagation; `ctx.t` for direct resolver errors; single canonical object type (returned, not re-minted); input types allowed as separate closed definitions; codegen after schema changes; test-file document/import conventions (`TypedDocumentNode`, `@/test/helpers`, no backend imports in integration suites, `expectMutationError` reuse); per-file sub-loop verification.
- **Semantic-review checklist (protocol rule 3):** tenancy/BOLA — identity is the caller's own `ctx.user.id`; no identity argument exists so no cross-actor surface is even expressible (validation-time pin). Race conditions — the service's identity read → verify → write has a TOCTOU window only for row deletion (maps to the zero-write `UnauthorizedError` branch); the write is one guarded `UPDATE…WHERE id…RETURNING`. Enums-as-values — none touched. Cross-layer imports — none added (mutation → service via the existing `@/backend/services/auth` seam; mutation → input via the direct pothos-module import the file already used). Dead code — none. Deferred items — none implicated (D1/D2 untouched; `changeMyPassword` is intentionally NOT in Task 7's op-guard territory — it WILL be allowlisted there as a gated caller's only escape hatch).

## 5. Carry-Forward Knowledge (for Tasks 7/9/10/11)

- **Generated type names for the document task (Task 10's UI / Task 9's documents):** once `changeMyPasswordMutationDocument` lands in `frontend/graphql/sharedDocuments/auth/auth.documents.ts` and BOTH codegen steps re-run, the generated names that will appear are **`ChangeMyPasswordMutation`** and **`ChangeMyPasswordMutationVariables`** (`variables: { input: { currentPassword: string; newPassword: string } }` — both fields REQUIRED, no optional members). The SDL is already live (§1.3), so the document compiles with no further backend work. The wire suite's local probe document should then be swapped for the shared document import (single-source discipline — same note as Task 5's probe).
- **Task 7 (op-guard):** `changeMyPassword` is on the plan's CLOSED allowlist of root-field names (a flagged caller's only escape hatch) — the Apollo plugin must compare against this exact literal; `adminSetUserPassword` is deliberately NOT allowlisted.
- **Failure surface the UI maps on (plan §4.3):** wrong/missing current → `extensions.code = "CURRENT_PASSWORD_INVALID"` + `fields = [{ field: "currentPassword", code: "CURRENT_PASSWORD_INVALID", message }]` (the §4.3 table's "VALIDATION" label reads as the class family — the custom code is D5's thrice-repeated contract and rides the wire verbatim, verified on the wire here); new == current → `NEW_PASSWORD_SAME_AS_CURRENT` on field `newPassword`; empty/<8 → `VALIDATION` + `PASSWORD_REQUIRED`/`PASSWORD_TOO_SHORT` on field `password`. The `extractFieldErrors`-style projection works unchanged.
- **Wire-tier environment trap (twice now):** an orphaned `next-server` holding port 3066 plus Next's dev lockfile (`.next-test-dev/dev/lock`) makes `setupTestServerLifecycle` boot-fail with EADDRINUSE and the suite time out; `bun run test:kill` only guards port 3099 — kill the orphan by PID and remove the stale lock before re-running. No code relation.
- **Test-DB prerequisites held:** `must_change_password` column present (Task 1/2/4-fix rules), seed users present — no schema/seed operations were needed this task.
- Shared-worktree note: `git status` also carries the pre-existing Task 0/1/1-fix/2/3/4/4-fix/5/8 artifacts and the baseline `Caddyfile` edit; this task's own diff is exactly the 4 hand-edited files + 1 generated SDL file + plan-dir/worklog writes listed in §2.

## 6. Verification of plan §4.3 failure-contract mapping (observed on the wire)

| Condition | Observed | Matches §4.3/D5? |
|---|---|---|
| anonymous caller | `extensions.code = "UNAUTHORIZED"` (scope layer; resolver body never runs) | ✅ REQ-006.8 |
| current wrong | `extensions.code = "CURRENT_PASSWORD_INVALID"` + `fields [{ field: "currentPassword", code: "CURRENT_PASSWORD_INVALID", message }]`, zero writes (old credential still logs in) | ✅ REQ-006.2 |
| success | password-stripped `User` payload, `mustChangePassword: false`, old credential denied + new authorizes on the next `login` | ✅ REQ-006.5/6.7 |

## 7. CROSS-FILE DEPENDENCY (found AND fixed in this change — pin refresh)

```
CROSS-FILE PIN DRIFT (resolved):
  Found:    backend/graphql/test/schema-surface.test.ts — the 3 Surface-freeze pins
            (mutation set, admin contiguity slice, named-type delta) were ALREADY
            failing before this task: Task 5 shipped `adminSetUserPassword` +
            `AdminSetUserPasswordInput` but never registered them in the pins
            (pre-existing 93 pass / 3 fail state, reproduced BEFORE any Task-6 edit).
  Rule:     tests.instructions.md — "a stale pin asserts a false contract and hides
            real drift"; pins must be refreshed in the SAME change.
  Fix:      re-anchored all 3 pins to the live schema (adminSetUserPassword) AND
            registered this task's changeMyPassword + ChangeMyPasswordInput
            (§1.5) — suite now 101 pass / 0 fail.
  Report:   Task 5's outcome §3.2 claimed sub-loop exit 0 on its 4 files — the
            schema-surface suite was NOT among them, which is how the drift
            survived; wave-wide verification should include schema-surface.test.ts
            whenever any task adds a root operation or named type.
```
