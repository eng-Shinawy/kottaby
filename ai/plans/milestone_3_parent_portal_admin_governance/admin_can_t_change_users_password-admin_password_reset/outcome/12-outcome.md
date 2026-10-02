# Task 12 Outcome — Document structural lock + audit-census registration

> **Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
> **Task:** `12. Document structural lock + audit-census registration (D9, REQ-010)` (Phase 5 — Verification)
> **Date:** 2026-09-30 · **Agent:** general-purpose subagent · **Repo root:** `/home/z/my-project` (plan docs cite `/home/ahmed/Projects/kottaby_kottaby/`; paths resolve 1:1)
> **Result:** ALL THREE suites green — census drift test flipped RED → GREEN (**19 pass / 0 fail / 139 expect()**, bijection holds both directions, no skip-ledger entries), document structural lock **26 pass / 0 fail / 225 expect()** (13th table row + the new detail-fragment field-set pin), audit-completeness journey **20 pass / 0 fail / 787 expect()** (the census row executes through the REAL service path, denial matrix covers it, completeness oracle reconciles). Sub-loop `--lifecycle duplicates` **exit 0** on all 3 touched files; full-repo `bun tsgo` **0 errors / exit 0**. No commits made. Only code files touched: the two census/journey test files + the documents structural-lock test.

## 1. What Was Implemented

### 1.1 Census registration — `test/workflows/admin/audit-completeness.catalog.ts`

One `wired` row appended directly after `adminUpdateUser` in `ADMIN_ACTION_CENSUS`, mirroring the sibling `AdminUserManagementService` rows byte-for-byte in shape:

```typescript
{
  mutationField: "adminSetUserPassword",
  serviceEntry: "AdminUserManagementService.setUserPassword",
  expectedActionTypes: [AuditActionType.Update],
  expectedEntityType: "user",
  kind: "wired",
},
```

- `AuditActionType` was ALREADY a VALUE import in the catalog (`import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum"` — used as an object key/computed member throughout), so the new row uses the enum member, not a string literal.
- `ACTION_TYPE_COVERAGE` needed NO change: `Update` was already accounted `"wired"`, and the drift test's converse check ("every verb marked wired has a producing wired census row") is now satisfied by TWO user-lifecycle rows emitting `Update` (`adminUpdateUser` + `adminSetUserPassword`).
- The deferred row `(future) adminResetUserPassword` (D-003) stays byte-untouched — the shipped mutation is `adminSetUserPassword`, a DIFFERENT field name, so the "deferred rows stay outside the shipped mutation namespace" pin is unaffected.

### 1.2 Census execution + denial coverage — `test/workflows/admin/audit-completeness.journey.test.ts`

Four coordinated deltas (a census row without these would fail the journey loudly — the leg-partition pin, the runner-dispatch guard, and the denial-matrix honesty pin all key off the wired census set):

1. **`USER_LIFECYCLE_LEG`** gains `"adminSetUserPassword"` (between `adminUpdateUser` and `adminSetUserDeleted` — the mutation-registration order).
2. **`censusRunners.adminSetUserPassword`** (new runner, placed beside the `adminUpdateUser` runner): ONE real service call `AdminUserManagementService.setUserPassword(targetStudentId, { password: TARGET_CREDENTIAL, mustChangePassword: true }, adminA.userId, LOCALE)`, asserting the returned detail echoes `mustChangePassword === true`, then records exactly ONE `ExecutedAction` — `AuditActionType.Update` on the `user` anchor with `expectedDetails = { changedFields: ["credentials"], mustChangePassword: true }`. The journey's mapping oracle later proves the minted row carries EXACTLY those details (`parseAuditDetails(row)` `toEqual` — the service writes `buildAuditContract(actorId, Update, id, { changedFields: ["credentials"], mustChangePassword })` verbatim), so the 12.SEC contract "exactly ONE Update row, no orphan writes, no password/hash in details" is enforced at the real-DB tier. No new fixtures (the runner acts on the already-registered governance target; `tracked.size` stays 27); no notification spy (the credential op emits zero dispatches — absence is covered by the leg's whole-table notification baseline).
3. **Leg length pin**: `expect(legActions).toHaveLength(11)` → **12** in "producer executes the user-lifecycle census rows" (eleven toggle/rename executions + the ONE credentials Update), keeping the whole-table delta oracle exact.
4. **Denial matrix** gains the `adminSetUserPassword` attempt (valid-shaped input, `TARGET_CREDENTIAL` + `mustChangePassword: true`, so the denial is the authorization gate, never input validation — `assertActorAdminActive` throws BEFORE password validation/hashing). This restores the matrix-honesty pin: `attempts.map(field)` ≡ wired census rows. Non-admin waves → `ForbiddenError` + `tErrors.forbidden`; anonymous → `UnauthorizedError` + `tErrors.unauthorized` (same `assertActorAdminActive` gate family as the sibling `adminUpdateUser` attempt); per-actor + platform-wide zero-mint oracles unchanged and green.

Downstream reconciliation legs (mapping oracle, canonical-ordering, verb/type-axis filter sweeps, completeness oracle) all derive their expectations from `executedActions`, so they absorbed the 13th action with zero edits — and all pass.

### 1.3 Document structural lock — `frontend/graphql/sharedDocuments/admin/admin-users.documents.test.ts`

The 13th contract row + supporting pins, same structural assertions as the sibling detail-returning mutation rows:

- **Table row** (after `AdminUpdateUser`, before `AdminSetUserDeleted`): `document: adminSetUserPasswordMutationDocument`, `operationName: "AdminSetUserPassword"`, `channel: "mutation"`, `variables: ["id", "input"]`, `rootField: "adminSetUserPassword"`, `detailFragmentSpreads: ["adminSetUserPassword"]`. This auto-enrolls it in the named-operation/channel/variables tests, the argument-wiring test (both declared variables threaded, no literals), the id-first/fragment-reuse sweeps, and the zero-identity-argument belt (`id`/`input` already in the sanctioned set).
- **Variable-surface pin** updated: sorted union now 7×`id` + 3×`input` (comment rewritten: seven documents declare `$id: Int!`; create/update/credential-set each declare `$input`).
- **NEW detail-fragment field-set pin** — `AdminUserDetailFields fragment field set (detail wire contract incl. the credential-set observables)`: full top-level `fieldNames` pin over the shared fragment, proving **`mustChangePassword` IS selected** in `ADMIN_USER_DETAIL_FIELDS` (between `blockedAt` and `lastActiveAt`) and `passwordHash` stays structurally absent — the mirror of the existing `AdminUserListItemFields` field-set pin. (Task brief asked for exactly this assertion "if the row structure allows" — it does: the row's `detailFragmentSpreads` enroll it in fragment-reuse, and the shared fragment is pinned per-document-file via `adminUserDetailQueryDocument`.)
- **Codegen binding**: `typedAdminSetUserPassword: TypedDocumentNode<AdminSetUserPasswordMutation, AdminSetUserPasswordMutationVariables> = adminSetUserPasswordMutationDocument` (compile-time proof by assignment against the Task-9-generated types) + its runtime `.loc` expectation.
- **Barrel parity**: `adminSetPasswordViaBarrel` (from `@/frontend/graphql/sharedDocuments`) `.toBe` the deep-import instance — same-instance proof through `export *` flow.
- Header docblock + the id-first/fragment-reuse comment enumerations updated to include the credential-set mutation (the shared-documents AGENTS discipline: docs describe the locked surface).

No changes to `admin-users.documents.ts` (Task 9 shipped the document + fragment selection), the barrel chain, or generated files.

## 2. Files Modified / NOT Modified

| File | Change |
|---|---|
| `test/workflows/admin/audit-completeness.catalog.ts` | +1 `wired` census row (`adminSetUserPassword`) after `adminUpdateUser`. |
| `test/workflows/admin/audit-completeness.journey.test.ts` | +`"adminSetUserPassword"` in `USER_LIFECYCLE_LEG`; +`censusRunners.adminSetUserPassword` (ONE service call + ONE recorded Update action); leg-length pin 11 → 12; +denial-matrix attempt. |
| `frontend/graphql/sharedDocuments/admin/admin-users.documents.test.ts` | +type imports (`AdminSetUserPasswordMutation`/`Variables`); +barrel alias `adminSetPasswordViaBarrel`; +deep import; +13th table row; variable-surface pin 7×`id`/3×`input`; +detail-fragment field-set pin (asserts `mustChangePassword` selected, `passwordHash` absent); +typed binding + `.loc` expectation; +barrel-parity line; docblock/comment enumerations extended. |
| `ai/plans/…/outcome/12-outcome.md` | This file. |
| `ai/plans/…/tasks.md` | Task 12 main line + `12.QL/12.TE/12.SEC/12.SR/12.IV` flipped only. |
| `worklog.md` | Appended Task 12 record. |

**NOT modified (and why):** `backend/db/test/logic/audit/audit-census-drift.test.ts` (generic bijection scanner — fixed via the catalog row, exactly as the task boundary prefers; the RED→GREEN flip proves it consumed the new row); `admin-users.documents.ts` + `sharedDocuments/**` barrels + `generated/**` (Task 9 deliverables consumed as-is); `backend/**` (service/repo/audit seams shipped in Tasks 3/5; no bespoke audit path added or needed); `deferred-items.md` (D-003's `(future) adminResetUserPassword` row is a DIFFERENT, still-future surface); helpers/**; locale files.

## 3. Verification Results

| Gate | Result |
|---|---|
| `bun run test/scripts/run-test.ts backend/db/test/logic/audit/audit-census-drift.test.ts` | **19 pass / 0 fail / 139 expect()** — previously RED (3 fails, `missingFromCensus: ["adminSetUserPassword"]`); now the bijection test passes BOTH directions (`missingFromCensus: []`, `unwiredCensusRows: []`), wired-row distinctness holds, the skip ledger stays empty, and Update reconciles through `ACTION_TYPE_COVERAGE` (wired-backed + converse checks). |
| `bun run test/scripts/run-test.ts frontend/graphql/sharedDocuments/admin/admin-users.documents.test.ts` | **26 pass / 0 fail / 225 expect()** (was 25 tests — the new detail-fragment field-set pin added the 26th; the 13-row table grew every table-driven test's coverage). |
| `bun run test/scripts/run-test.ts test/workflows/admin/audit-completeness.journey.test.ts` | **20 pass / 0 fail / 787 expect()** — user-lifecycle leg 12/12 executions incl. the ONE credentials `Update`; whole-table delta oracles exact at every leg; the 1:1 mapping oracle matches the minted row's `details` byte-exactly (`changedFields: ["credentials"]`, `mustChangePassword: true`); denial matrix covers all 28 wired actions × 3 non-admin actors + anonymous with zero mint; completeness oracle (`minted = baseline + executedActions + 1`) green. `[DOMAIN]` log lines in the run log are the expected debug-level emissions of the denial legs, not failures. |
| `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` | **exit 0** on all 3 touched files (catalog `/tmp/subloop-t12-catalog.log`, journey `/tmp/subloop-t12-journey.log`, documents test `/tmp/subloop-t12-docs.log`) — tsgo → oxlint → biome → lint:type-aware → check:duplicates, 5/5 stages each. |
| `bun tsgo` | **exit 0, 0 "error TS" lines** (full repo). |

## 4. Subtask Pipeline

- **12.QL** ✅ — sub-loop `--lifecycle duplicates` exit 0 on all three touched test/catalog files (§3, 5/5 stages each).
- **12.TE** ✅ — document lock green (26/0/225; 13th row + fragment pin); census drift test green — the RED baseline from midpoint-review-R1 finding F1 is fixed: bijection holds in both directions and the `Update` count reconciles (the drift test's coverage-backing + converse pins, plus the journey's verb-axis sweep counting the minted Update rows).
- **12.SEC** ✅ — the census row's journey execution asserts a password op writes EXACTLY ONE `Update` row: the runner records one action, the leg's whole-table delta (`auditBefore + legActions.length`) rejects orphan writes platform-wide, and the 1:1 mapping oracle pins the minted row's exact details (`changedFields: ["credentials"]`, `mustChangePassword: true` — no password, no hash); denial legs (3 non-admin actors + anonymous) mint ZERO rows.
- **12.SR** ✅ — `AuditActionType` imported as a VALUE (pre-existing value import in both census files; the journey's enum members are values); no census row duplicated (drift test's distinctness pin green; the deferred D-003 row names a different future field); no bespoke audit path (the runner calls the shipped `AdminUserManagementService.setUserPassword`, whose audit row is the Task-3 in-tx `AuditService.createAuditLog` write — nothing new minted outside it).
- **12.IV** ✅ — read in full BEFORE editing: `frontend/graphql/sharedDocuments/AGENTS.md` (barrel/consumer conventions, TypedDocumentNode naming — the test extends the existing lock in that discipline), `test/workflows/AGENTS.md` (12 rules — no runInRollback, tracked fixtures, honest authorization via the real gate, no `rejects.toThrow`), `.agents/instructions/tests.instructions.md` (run-test script, no console.*, enum-as-value, stale-pin rule), root `AGENTS.md`; sub-loop re-printed the tests instructions per file.
- Semantic-review notes: the census row is a pure data addition (no runtime behavior); the journey runner reuses the existing governance target + `TARGET_CREDENTIAL` policy-valid credential (no new fixtures, no cleanup-surface change — `tracked.size` pin stays 27 and the zero-residue teardown probes passed); the denial attempt short-circuits at `assertActorAdminActive` BEFORE bcrypt, so the wave adds no measurable hashing; the documents-lock row is pure AST inspection (no server/DB/network). Parallel-suite safety: the whole-table oracles are already baseline-scoped, and the new action lands inside the existing `auditBefore` windows.

## 5. Carry-Forward Knowledge (for Task 14)

- **Baselines for the final gate:** census drift 19/0/139; documents lock 26/0/225; audit-completeness journey 20/0/787; `bun tsgo` 0 errors; sub-loop exit 0 ×3. Task 14's `test/workflows` sweep will re-run this journey — its user-lifecycle leg now expects **12** executions; any future census row must repeat this task's four-part coordination (census row + leg entry + runner + denial attempt + length pins).
- **F1 (midpoint-review-R1) is CLOSED:** `adminSetUserPassword` ↔ census bijection is enforced; the "census-before-admin-mutation" rule is restored for the whole corpus.
- **The census row ↔ runner ↔ denial-matrix triple-lock:** three separate pins (`legFields ≡ wiredFields`, `censusRunners` throw-on-missing, `attemptFields ≡ wiredFields`) mean a census row can no longer ship untested or un-denied — the pattern to mirror for any future admin mutation.
- **Deferred D-003 note:** `(future) adminResetUserPassword` remains ledger-backed and OUTSIDE the shipped namespace; the shipped `adminSetUserPassword` census row does not satisfy/consume D-003 (different surface — a future reset flow, not credential setting).
- Shared-worktree note: the worktree also carries the other tasks' artifacts (Tasks 0–11, 13); this task's own code diff is exactly the three files in §2 (+ plan-dir/worklog writes).

## 6. Cross-File Dependencies

- None open. The midpoint gate's tracked F1 item resolves with this task; Task 14 consumes only the baselines in §5. The census catalog is imported by both the drift test and the journey — future catalog edits must keep the journey's four-part coordination in sync (the suite fails loudly otherwise, by design).
