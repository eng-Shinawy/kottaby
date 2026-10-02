# Task 5 Outcome — `adminSetUserPassword` mutation + `AdminSetUserPasswordInput` + `mustChangePassword` Pothos fields + codegen + wire test

> **Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
> **Task:** `5. adminSetUserPassword mutation + AdminSetUserPasswordInput + mustChangePassword Pothos fields + codegen + wire test (D2, REQ-003, REQ-007, REQ-009)` (Phase 3 — GraphQL Surface)
> **Date:** 2026-09-30 · **Agent:** general-purpose subagent · **Repo root:** `/home/z/my-project` (plan docs cite `/home/ahmed/Projects/kottaby_kottaby/`; all paths resolve 1:1 relative to the repo root)
> **Result:** 1 new mutation field + 1 new closed input + 2 new `Boolean!` fields wired to the Task-3 service; codegen pipeline clean; wire suite **49 pass / 0 fail / 319 expect()** (44 pre-existing + 5 new); sub-loop exit 0 on all 4 touched files; full-repo `bun tsgo` **0 errors / exit 0**. No commits made.

## 1. What Was Implemented

### 1.1 Closed input — `AdminSetUserPasswordInput` (`backend/graphql/pothos/admin/admin-user.pothos.ts`)

New `gqlSchemaBuilder.inputType("AdminSetUserPasswordInput", …)` appended directly after the (byte-untouched) `AdminUpdateUserInput` — a dedicated closed credential input, NOT a widening of the closed five-field profile whitelist:

```typescript
export const AdminSetUserPasswordInput = gqlSchemaBuilder.inputType("AdminSetUserPasswordInput", {
  fields: t => ({
    password: t.string({ required: true }),
    mustChangePassword: t.boolean({ required: true }),
  }),
});
```

EXACTLY two fields; `passwordHash`, `email`, `role`, and every governance field are structurally unreachable through the shape (REQ-003.6). JSDoc documents the closed-two-key discipline, the distinct credential audit semantics (`changedFields: ["credentials"]`), and the plaintext lifetime (hashed by the service before persistence; never stored/logged/audited/echoed). **`AdminUpdateUserInput` is byte-identical to before** (verified: it sits between two untouched blocks; the only file delta is the appended input + the detail field below). Auto re-exported by the `backend/graphql/pothos/admin/index.ts` barrel (`export *`) — zero barrel edits.

### 1.2 `AdminUserDetail.mustChangePassword: Boolean!` (same file)

Added to `AdminUserDetailPothosObject` beside the governance-boolean block (`isBlocked`/`blockedAt`), the plan's exact resolver shape:

```typescript
mustChangePassword: t.field({
  type: "Boolean",
  nullable: false,
  resolve: parent => parent.mustChangePassword ?? false,
}),
```

Source value is `AdminUserDetailReturnType extends AdminUserSafeSelect` (structurally carries `mustChangePassword: boolean` since Task 1/1-fix wired `SAFE_USER_SELECT` ↔ `AdminUserDetailRow` ↔ `assembleDetail`) — no type work needed, matching 1-outcome §10.

### 1.3 `User.mustChangePassword: Boolean!` (`backend/graphql/pothos/users/user.pothos.ts`)

Added to `UserPothosObject` after the `isDeleted`/`suspended`/`isBlocked` read-only-governance block, the `isDeleted` boolean-resolver pattern verbatim:

```typescript
mustChangePassword: t.boolean({
  resolve: parent => parent.mustChangePassword ?? false,
}),
```

Backed by `RegistrationReturnType` (`Omit<UserSelectType, "passwordHash"> & { preferredRecitation }`), which has carried `mustChangePassword` since Task 1. The file-header docblock's governance-field list was extended with `mustChangePassword`. This is the canonical `User` object returned by `me`/`login`/`registerUser`, so the flag is observable on every session surface (REQ-009.4 — exactly two objects gained the field, both this and `AdminUserDetail`; the 4-fix raw-SQL column fix guarantees the value is a real boolean on production no-tx reads).

### 1.4 Mutation — `adminSetUserPassword` (`backend/graphql/mutation/admin/admin-users.mutation.ts`)

Registered as a side-effect `gqlSchemaBuilder.mutationField(...)` immediately after `adminUpdateUser` (beside it, before `adminSetUserDeleted`), mirroring the file's established shapes exactly:

- `args: { id: t.arg({ type: "Int", required: true }), input: t.arg({ type: AdminSetUserPasswordInput, required: true }) }` — the file's id-arg precedent (`adminUpdateUser`/`adminSetUserDeleted` use the identical `t.arg({ type: "Int", … })` form).
- `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` — the `$all` conjunction precedent verbatim (`UserRole` already imported as a VALUE at the top of the file). Anonymous → `UNAUTHORIZED` (401); authenticated non-admin → `FORBIDDEN` (403), both BEFORE the resolver body runs.
- Resolver: `resolveAdminUserMutationTarget(ctx.user, args.id)` prelude (UnauthorizedError if no user; `requirePositiveIntId`) → property-mapped service delegation with ZERO business logic in the resolver:

```typescript
return AdminUserManagementService.setUserPassword(
  id,
  { password: input.password, mustChangePassword: input.mustChangePassword },
  actorId,
  ctx.locale
);
```

BOPLA property mapping (never a spread of the GraphQL input); `ctx.locale` propagated; returns the canonical `AdminUserDetailPothosObject`. No `outerTx` — the production resolver path (the service's optional 5th param omitted). Header docblock updated (mutation enumeration + SDL contract list gained the `adminSetUserPassword(id: Int!, input: AdminSetUserPasswordInput!): AdminUserDetail!` line). Barrel wiring unchanged: `mutation/admin/index.ts` side-effect-imports the file, which flows `mutation/index.ts` → `gqlSchema.ts`.

### 1.5 Codegen pipeline (generated artifacts, via the commands ONLY)

```
bun run generate:gqlSchema   → wrote frontend/graphql/generated/schema.graphql (61976 bytes) — exit 0
bun codegen                  → ✔ Generate to ./frontend/graphql/generated/gql/graphql.ts — exit 0
```

**Verified in the generated SDL** (`frontend/graphql/generated/schema.graphql` — lexicographically sorted, diff = exactly 8 lines):

```graphql
input AdminSetUserPasswordInput {
  mustChangePassword: Boolean!
  password: String!
}

type AdminUserDetail {
  # …existing fields…
  mustChangePassword: Boolean!
}

type Mutation {
  # …existing fields…
  adminSetUserPassword(id: Int!, input: AdminSetUserPasswordInput!): AdminUserDetail!
}

type User {
  # …existing fields…
  mustChangePassword: Boolean!
}
```

Exactly the plan §4.1 surface (the `changeMyPassword` half of §4.1 belongs to Task 6 and is correctly absent). **Honest note on `graphql.ts`:** the typed-operations output is UNCHANGED by this task — `typescript-operations` emits only operation-derived/input types referenced by scanned documents (`codegen.ts documents` = `sharedDocuments/**` + `views/**/*.documents.ts`), and no scanned document references the new surface until the Task-9 document lands (same mechanism that keeps `HealthCheck` — an unreferenced schema type — out of `graphql.ts` today). The generated file was never hand-edited; Task 9's `adminSetUserPasswordMutationDocument` + `mustChangePassword` fragment selection will generate `AdminSetUserPasswordMutation`, `AdminSetUserPasswordMutationVariables`, and the `mustChangePassword` member on the detail types. `bun tsgo` 0 confirms nothing downstream broke.

### 1.6 Wire test extension (`frontend/graphql/test/admin/admin-users.integration.test.ts`)

+5 tests (44 → 49) wired into the existing tier structure; the operation count is now EIGHT:

| Where | Test | Asserts |
|---|---|---|
| Tier 1 (anonymous) | `adminSetUserPassword → UNAUTHORIZED; zero audit writes` | scope-layer denial; `countAllAuditRows()` delta 0 |
| Tier 2 (×3 roles: student/parent/teacher) | `${role} actor → adminSetUserPassword → FORBIDDEN; zero audit writes` | `$all { role: [Admin] }` denies each non-admin at the scope layer; audit delta 0 |
| Tier 3 (admin, deliberately LAST — see below) | `admin → adminSetUserPassword rotates the credential; flag echoed; ONE audit row; no 'passwordHash' leak` | success error-free; `id` first key (Apollo normalization); `role === Student`; echoed `mustChangePassword === true` (the new `AdminUserDetail` field observable on the wire); `deepFindKey(result.data, "passwordHash") === false`; exactly ONE audit row (`auditBefore + 1`) |

- **Probe document:** a locally `parse`d `TypedDocumentNode` (`parse` from `graphql`, the `evaluation-rubric.test.ts` / `subscription-admin.test.ts` convention) with a local wire interface — the shared documents barrel (`admin-users.documents.ts`) is outside this task's write scope (the shared `adminSetUserPasswordMutationDocument` + fragment extension are Task 9 deliverables). The probe selects `id email fullName role mustChangePassword` so the new detail field is exercised on the wire; mutation-argument-coverage rule satisfied (the input has exactly two REQUIRED fields, both always passed — no optional fields exist).
- **Placement rationale (commented in the test):** the Tier-3 `adminUserActivity` test pins the matrix user's audit trail to EXACTLY four rows (create → update → delete → reactivate, newest-first). The credential rotation writes a fifth `Update` row about the same user, so the happy path deliberately runs AFTER that assertion — the 4-row timeline pin and the ONE-audit-row pin are both exact.
- `ADMIN_OPERATIONS` drift-guard list extended to 8 entries (`adminSetUserPassword` inserted before `adminSetUserDeleted`), `toHaveLength` pin 7 → 8, and the tier describe titles/header counts updated (seven → eight; Tier 3 six → seven).
- Tier 4 and the existing hygiene `afterAll` (`deleteUsersByIds` by explicit id) untouched — the flagged user is cleaned up like every fixture.

## 2. Files Modified / NOT Modified

| File | Change |
|---|---|
| `backend/graphql/pothos/admin/admin-user.pothos.ts` | +`AdminUserDetail.mustChangePassword` field (+JSDoc); +`AdminSetUserPasswordInput` (+JSDoc). `AdminUpdateUserInput` byte-identical. |
| `backend/graphql/pothos/users/user.pothos.ts` | +`User.mustChangePassword` field (+comment); header governance-field list extended. |
| `backend/graphql/mutation/admin/admin-users.mutation.ts` | +`AdminSetUserPasswordInput` import; header docblock (enumeration + SDL line); +`adminSetUserPassword` mutation field. |
| `frontend/graphql/generated/schema.graphql` | +8 lines — GENERATED by `bun run generate:gqlSchema` (never hand-edited). |
| `frontend/graphql/test/admin/admin-users.integration.test.ts` | +5 tests; +`parse`/`TypedDocumentNode` imports; +probe wire interface + document; `ADMIN_OPERATIONS` 8 + drift pin; tier-title count updates. |
| `ai/plans/…/outcome/5-outcome.md` | This file (new). |
| `ai/plans/…/tasks.md` | Task 5 main line + `5.QL/5.TE/5.SEC/5.SR/5.IV` flipped only. |
| `worklog.md` | Appended Task 5 record. |

**Files NOT modified (and why):** `backend/graphql/pothos/admin/index.ts` + `mutation/admin/index.ts` + `mutation/index.ts` (barrels auto-flow via `export *` / side-effect imports), `frontend/graphql/generated/gql/graphql.ts` (codegen ran; output unchanged because no scanned document references the new surface until Task 9's document — hand-editing generated output is prohibited), `admin-users.documents.ts` (Task 9), `user.mutation.ts`/`changeMyPassword` (Task 6), services/repos/types (Tasks 2/3/4 consumed as-is), `apollo-server.ts`/op-guard (Task 7), shared/locale/** (Task 8 already shipped every key; none needed here), audit-census catalog (Task 12).

## 3. Verification Results

### 3.1 5.TE — wire/integration suite

`bun run test/scripts/run-test.ts frontend/graphql/test/admin/admin-users.integration.test.ts` (spawns the Next.js dev server on the test port via `setupTestServerLifecycle`; server compiled the NEW schema — the log shows `AdminSetUserPassword` operations served, incl. `UnauthorizedError`/`ForbiddenError` boundary rejections with `operationName: "AdminSetUserPassword"`):

- **49 pass / 0 fail / 319 expect() calls / ~27s** (pre-existing 44 + 5 new, all green on the first run).
- Codegen types resolve (`bun tsgo` 0 — every generated/imported shape in the touched files type-checks); the input is EXACTLY 2 fields (SDL §1.5 is the proof; the closed input is also the only arg surface the resolver reads).

### 3.2 5.QL — sub-loop `--lifecycle duplicates` (tsgo → oxlint → biome → lint:type-aware → check:duplicates)

| File | Exit | Log |
|---|---|---|
| `backend/graphql/mutation/admin/admin-users.mutation.ts` | **0** (5/5 stages) | `/tmp/subloop-t5-mutation.log` |
| `backend/graphql/pothos/admin/admin-user.pothos.ts` | **0** (5/5 stages) | `/tmp/subloop-t5-adminpothos.log` |
| `backend/graphql/pothos/users/user.pothos.ts` | **0** (5/5 stages) | `/tmp/subloop-t5-userpothos.log` |
| `frontend/graphql/test/admin/admin-users.integration.test.ts` | **0** (5/5 stages) | `/tmp/subloop-t5-test.log` |

### 3.3 Type check

Full-repo `bun tsgo` → **0 "error TS" lines, tool exit 0** (run twice: post-edit verification + count) — zero NEW errors vs the Task-0 baseline.

## 4. Subtask Pipeline

- **5.QL** ✅ — §3.2: 4/4 files exit 0 (all five stages each).
- **5.TE** ✅ — wire suite green via run-test (49/0/319, first-run green); codegen pipeline exit 0 both steps with the SDL verified §1.5; input exactly 2 fields.
- **5.SEC** ✅ — `AdminUserDetail` remains backed by `AdminUserDetailReturnType extends AdminUserSafeSelect` (`Omit<UserSelectType, "passwordHash">`, `backend/types/admin/admin-user.types.ts`) and the wire suite deep-walks `passwordHash` on the credential mutation's response (plus the pre-existing walks on every other admin payload); the scope layer denies anonymous (`UNAUTHORIZED`) and non-admin (`FORBIDDEN`) BEFORE the resolver body (server log shows the boundary rejections), with the service's strict `assertActorAdminActive` gate as the inner ring (defense in depth); audit delta pinned to exactly ONE row on success and ZERO on every denial.
- **5.SR** ✅ — no local type defs added in Pothos (fields ride `AdminUserDetailReturnType` / `RegistrationReturnType` from `@/backend/types`; the only new shape is the sanctioned GraphQL input type, per the "input types are allowed as separate definitions" rule); single canonical object type per entity (fields added to the existing `AdminUserDetail`/`User` refs — no second `User` type minted); resolver delegates to the service with zero business logic; enums as values (`UserRole.Admin` value import, pre-existing); generated files updated ONLY via the two codegen commands.
- **5.IV** ✅ — read in full BEFORE editing: `backend/graphql/AGENTS.md`, `backend/types/AGENTS.md`, `backend/AGENTS.md`, root `AGENTS.md`, `.agents/instructions/backend.instructions.md`, `.agents/instructions/tests.instructions.md`; sub-loop additionally printed (and all read): `.agents/instructions/frontend.instructions.md`, `frontend/AGENTS.md`, `frontend/graphql/AGENTS.md`, `frontend/graphql/test/AGENTS.md`. Every honored rule of note: per-field scope with explicit `$all` conjunction; thin resolvers + `ctx.locale` propagation; single canonical object type; no local Pothos types; codegen after schema changes; test-file document/import conventions.
- **Semantic-review checklist (protocol rule 3):** tenancy/BOLA — target identity is the admin-supplied `id` behind the admin-only scope + strict service gate; no cross-tenant surface (users are global in this schema). Race conditions — single guarded `UPDATE…WHERE id…RETURNING` inside the service's `withTransaction`; concurrent rotations serialize on the row lock (last-writer-wins, each writes its own audit row — plan §5.1). Enums-as-values — `UserRole.Admin` imported as a VALUE; no string literals for enum members. Cross-layer imports — none added (mutation → service via the existing `@/backend/services` seam; pothos → types via `@/backend/types`). Dead code — none. Deferred items — none implicated (D1..D6 untouched; `adminSetUserPassword` is deliberately NOT on the future op-guard allowlist — a flagged user is denied like every other gated field).

## 5. Carry-Forward Knowledge (for Tasks 6/9/11/12/14)

- **Task 9 (admin document + hooks + dialog):** after adding `adminSetUserPasswordMutationDocument` to `frontend/graphql/sharedDocuments/admin/admin-users.documents.ts` (with `mustChangePassword` appended to `ADMIN_USER_DETAIL_FIELDS`), re-run `bun run generate:gqlSchema && bun codegen` — the generated names that will appear are **`AdminSetUserPasswordMutation`** and **`AdminSetUserPasswordMutationVariables`** (`variables: { id: number; input: { password: string; mustChangePassword: boolean } }` — both fields REQUIRED), and the `AdminUserDetail*` operation types gain `mustChangePassword: boolean`. The SDL is already live (§1.5), so the document compiles against the schema with no further backend work.
- **Task 6 (`changeMyPassword`)** owns the other half of §4.1 (`ChangeMyPasswordInput` + `User.mustChangePassword` is ALREADY wired and observable — the mutation returns the canonical `UserPothosObject`, so the flag echo needs zero extra work there).
- **Task 11 (journey):** the wire layer proves admin-allowed/non-admin-denied/anonymous-denied + one-audit-row + hash-absence; the journey inherits the same contracts at the service tier (`changedFields: ["credentials"]` details, flag both directions).
- **Task 12 (census):** `adminSetUserPassword` emits its audit row at the service layer (Task 3); register it in `ADMIN_ACTION_CENSUS` + `USER_LIFECYCLE_LEG` with `expectedActionTypes: [AuditActionType.Update]` or the drift bijection fails.
- **Probe-document note for the test suite:** the wire suite's locally `parse`d probe document and wire interface should be REPLACED by the shared `adminSetUserPasswordMutationDocument` import when Task 9 lands it (the single-source discipline) — the probe was used only because the shared documents file is outside this task's write scope.
- **Test-DB prerequisites held:** `must_change_password` column present in both DBs (Task 1/2 rule), seed users present (Task 3 rule) — no schema/seed operations were needed this task.
- Shared-worktree note: `git status` also carries the pre-existing Task 0/1/1-fix/2/3/4/8 artifacts and the baseline `Caddyfile` edit; this task's own diff is exactly the 4 hand-edited files + 1 generated SDL file + plan-dir/worklog writes listed in §2.
