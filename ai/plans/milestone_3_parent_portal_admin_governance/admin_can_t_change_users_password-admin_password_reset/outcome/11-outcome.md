# Task 11 Outcome — Cross-actor journey `admin-password-reset.journey.test.ts`

> **Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
> **Task:** `11. Journey test/workflows/admin/admin-password-reset.journey.test.ts (test-first, D9, REQ-008)` (Phase 5 — Verification)
> **Date:** 2026-09-30 · **Agent:** general-purpose subagent · **Repo root:** `/home/z/my-project` (plan docs cite `/home/ahmed/Projects/kottaby_kottaby/`; paths resolve 1:1)
> **Result:** NEW journey file, **7 pass / 0 fail / 191 expect()** green FIRST RUN and green on a second consecutive run (idempotent-teardown proof, zero residue); sub-loop `--lifecycle duplicates` on the journey file **exit 0** (5/5 stages); full-repo `bun tsgo` **0 errors / exit 0**; precedent suites re-run green (`admin-user-lifecycle` 7/0/115, `admin-user-denials` 8/0/97). No commits made. Only file created: the journey test (+ this outcome + tasks.md flips + worklog).

## 1. What Was Implemented

`test/workflows/admin/admin-password-reset.journey.test.ts` (NEW, ~540 lines incl. docblocks) — "Journey D — Admin Password Reset (Temporary Credential → Forced Change)": the full forced-reset arc over ONE shared `users` row, attributed step-by-step to three honest actors:

| Actor | Provisioned by | Role rows |
|---|---|---|
| Admin | `provisionAdminActor(tx, { tracked })` | `users.role="admin"` + `admin` row |
| Target | `provisionCertifiedTeacherActor(tx, { tracked })` | `users.role="teacher"` + approved `teacher` row |
| Foreign non-admin | `provisionStudentActor(tx, { tracked })` | `users.role="student"` + `students` row |

Layer rules honored (`test/workflows/AGENTS.md`): NO `runInRollback`; cast provisioned inside ONE committing `db.transaction(...)` in `beforeAll` (commit-or-nothing); every created row tracked via `TrackedFixtures`; per-run prefix `jrn_adminpwd_<uuid8>` — actors are relabeled inside the provisioning transaction with explicit field-mapped updates (`relabelActorFixture`: `fullName`/`email` = `<prefix>-<label>@journey.test`), so emails/names carry the mandated unique prefix while provisioning stays 100% on the actor-context factory (REAL rows, no hand-rolled inserts, no seeded rows). Denials use the in-file `expectJourneyError` try/catch helper + translated substrings (`getServerTranslations("en")`); no `expect(...).rejects.toThrow()`; no `console.*`; no `any`/unsafe assertions; `@/` aliases only.

**Boundary choice for step 5 (documented in the file header + here):** the forced-reset deny path is Apollo-layer ONLY (`passwordChangeGate.ts` `didResolveOperation`, before any resolver — a denied operation performs zero writes by construction) and NO backend service reads `mustChangePassword`, so **no service-level equivalent denial exists to call**. The journey therefore drives the gate's REAL exported seams against the target's REAL flagged DB row: `extractOperationRootFieldNames` on parsed probe documents, `isPasswordChangeRequired` (deny / allow matrix incl. the per-operation anti-smuggling rule), `isExemptRootField` + the frozen `PASSWORD_CHANGE_EXEMPT_ROOT_FIELDS` constant (Task 7 outcome §5 named exactly these seams for this journey), and the REAL denial carrier `buildPasswordChangeRequiredDenial` (ForbiddenError family, `code`/`extensions.code` = `PASSWORD_CHANGE_REQUIRED`, localized `errorsTranslations.passwordChangeRequired` message). There is no `evaluatePasswordChangeGate` export — the shipped seam names above are what the journey asserts.

**Notification boundary:** `setUserPassword` / `changeMyPassword` / `login` emit ZERO notifications by design (side-effect matrix), so per the AGENTS.md note ("Rule 5's dispatch spy still applies whenever a journey EXPECTS a dispatch") NO transport spy is installed — absence is asserted with cast-scoped `notifications` row counts (steps 1/2/6), the same row-count-delta convention the layer uses for side-effect absence.

## 2. The 8 Ordered Steps → Test Mapping

| Step (spec ordered list) | Journey element | Key assertions |
|---|---|---|
| 1. Fixtures commit (admin + target teacher + foreign non-admin) | `beforeAll` (committing tx, tracked) + **test "step 1"** | 3 real rows w/ roles Admin/Teacher/Student; `isDeleted=false`; `mustChangePassword=false` default; target email carries the prefix; zero audit rows + zero notifications for the cast |
| 2. Admin `setUserPassword(targetId, { password:"TempPass123", mustChangePassword:true })` | **test "step 2"** | detail `mustChangePassword=true` + deep-walk: `passwordHash` absent; DB row `comparePassword("TempPass123", stored)` true + flag true; **exactly ONE** `audit_logs` row (`Update`, actor=admin, entity=target, `entityType="user"`), parsed `details.changedFields` ≡ `["credentials"]`, `details.mustChangePassword=true`, raw JSON contains neither plaintext nor stored hash; zero notifications |
| 3. Target `login(email,"TempPass123")` succeeds; `session.user.mustChangePassword===true` (login does NOT clear) | **test "step 3"** | session user id/flag pinned + deep-walk no `passwordHash`; row re-read: flag STILL true, hash still verifies the temp credential |
| 4. Non-admin → `setUserPassword` → `FORBIDDEN`, zero writes, zero audit rows | **test "step 4"** | foreign actor's real call → `ForbiddenError` + `tErrors.forbidden` (honest strict gate `assertActorAdminActive`, no monkey-patching); flag still true; temp hash still verifies; the attempted credential does NOT verify; cast-scoped audit count delta = 0 |
| 5. Target → non-exempt op → `PASSWORD_CHANGE_REQUIRED` | **test "step 5"** | real flagged row → `isPasswordChangeRequired` true for `adminSetUserPassword` root (single + mixed `{me, adminSetUserPassword}` per-operation deny); `isExemptRootField("adminSetUserPassword")===false` + not in the frozen allowlist; exempt escape hatches (`changeMyPassword`, `updateMyLocale`) still allowed while flagged; real carrier = ForbiddenError with `PASSWORD_CHANGE_REQUIRED` + constant localized message; zero writes / zero audit delta |
| 6. Target `changeMyPassword({ current:"TempPass123", new:"NewPass456" })` → new hash verifies + flag false | **test "step 6"** | result `mustChangePassword=false` + deep-walk no `passwordHash`; DB: flag false, `comparePassword("NewPass456")` true, `comparePassword("TempPass123")` false; ZERO audit rows (self-service unaudited) + zero notifications |
| 7. Previously-denied op now ALLOWED; re-login with new succeeds, old fails | **test "step 7"** | same gated probe now `isPasswordChangeRequired === false` against the real cleared row; real post-clear service op `AuthService.updateMyLocale(target, "ar")` succeeds (`locale="ar"`, flag stays false, no hash); `login("NewPass456")` succeeds; `login("TempPass123")` → `UnauthorizedError` + `tAuth.invalidCredentials` |
| 8. Tracked `afterAll` → zero residue | `afterAll` | audit rows deleted first (actor OR user-entity scope, under `withAuditDeleteTriggersSuspended` — the `journeyCleanup` seam), then `TrackedFixtures.cleanup()` (reverse-order hard-delete + mandatory existence probes, throws on ANY residue), then an explicit audit-residue probe throws if any audit row still references the cast. Proven by TWO consecutive green runs |

Extra cross-actor hygiene per rule 12: `assertCastUntouched()` re-reads the admin + foreign `users` rows after every step and compares byte-identity against `beforeAll` snapshots (the target row is excluded — the journey deliberately mutates it); audit counts are **cast-scoped** (actorId IN ids OR user-entity IN ids), immune to parallel-suite churn.

## 3. Files Created / NOT Modified

| File | Change |
|---|---|
| `test/workflows/admin/admin-password-reset.journey.test.ts` | NEW — the journey (only code file created) |
| `ai/plans/…/outcome/11-outcome.md` | This file |
| `ai/plans/…/tasks.md` | Task 11 main line + `11.QL/11.TE/11.SEC/11.SR/11.IV` flipped only |
| `worklog.md` | Appended Task 11 record |

**NOT modified (and why):** `test/workflows/helpers/**` — zero helper changes were needed (`provision*Actor` + `TrackedFixtures` + `withAuditDeleteTriggersSuspended` composed as-is; the audit-deletion step mirrors `journey-cleanup.ts` in-file instead of touching shared scaffolding); `admin-user-lifecycle.journey.test.ts` / `admin-user-denials.journey.test.ts` (no duplication — minimal 3-actor cast via the actor-context factory instead of the full 5-actor `createJourneyFixtures` cast those journeys use; only the try/catch `expectJourneyError` helper follows the layer's in-file convention); `backend/**` (all consumed surfaces shipped: `setUserPassword`, `changeMyPassword`, `updateMyLocale`, `login`, `passwordChangeGate.ts` exports); no generated files; no locale files.

## 4. Verification Results

- **11.TE** — `bun run test/scripts/run-test.ts test/workflows/admin/admin-password-reset.journey.test.ts` → **7 pass / 0 fail / 191 expect()**; run TWICE consecutively — both green (idempotent teardown / zero-residue proof per AGENTS.md). Precedent breakage check: `admin-user-lifecycle.journey.test.ts` → **7 pass / 0 fail / 115 expect()**; `admin-user-denials.journey.test.ts` → **8 pass / 0 fail / 97 expect()**.
- **11.QL** — `bun run scripts/health/sub-loop.ts test/workflows/admin/admin-password-reset.journey.test.ts --lifecycle duplicates` → **exit 0** (tsgo ✅ → oxlint ✅ → biome ✅ → lint:type-aware ✅ → check:duplicates ✅; journey files sit outside the jscpd scan scope, reported as a pass by the tool).
- **Type check** — full-repo `bun tsgo` → **0 "error TS" lines, tool exit 0**.
- Honest notes: the two `[DOMAIN]` log lines in the run log (`actor is not admin`, `login password mismatch`) are the expected `logDomainError` emissions of the two denial legs (debug-level in test mode), not failures.

## 5. Subtask Pipeline

- **11.QL** ✅ — §4: sub-loop exit 0 on the journey file (5/5 stages).
- **11.TE** ✅ — §4: journey green (7/7 steps incl. the non-admin denial leg + the flagged-gate denial leg); zero residue after cleanup (second consecutive green run + throwing residue probes).
- **11.SEC** ✅ — denial legs use honest roles (foreign student's REAL call fails through `assertActorAdminActive`; the flagged fence is asserted through the REAL gate predicate + REAL denial carrier — no monkey-patching anywhere); denials are constant-shape (`tErrors.forbidden` / `PASSWORD_CHANGE_REQUIRED` / `tAuth.invalidCredentials`, no existence oracles); `passwordHash` absent from EVERY output — deep recursive walker (`assertNoPasswordHashField`) over the detail result, both session users, the changeMyPassword and updateMyLocale returns, plus the audit-JSON plaintext/hash non-containment pins.
- **11.SR** ✅ — no `runInRollback`; no duplication of the lifecycle/denials journeys (3-actor minimal cast, own workflow, own prefix domain); no notification spy needed (zero dispatch expected — cast-scoped row-count absence asserted, the AGENTS.md-sanctioned delta pattern); no helper/barrel edits; no `console.*`; enum values (`AuditActionType.Update`, `UserRole.*`) imported as VALUES.
- **11.IV** ✅ — read in full BEFORE authoring: `test/workflows/AGENTS.md` (all 12 rules), `.agents/instructions/tests.instructions.md`, root `AGENTS.md`, plus the plan's tasks.md/plan.md §5.2/specs.md REQ-008 and outcomes 3/4/7/10; sub-loop re-printed the tests instructions for the file.
- Semantic-review notes: race conditions — none introduced (login's fire-and-forget `lastActiveAt` touch only races on a column this journey never byte-compares for the target); fixtures-commit-or-nothing (single tx `beforeAll`); trigger-immutable `audit_logs` never tracked in the registry — deleted explicitly under the sanctioned trigger-suspension seam and residue-probed instead (a leak fails the suite loudly).

## 6. Carry-Forward Knowledge (for Tasks 12/14)

- **Task 12 (census):** the journey pins `setUserPassword` ⇒ exactly ONE `Update` audit row with `details.changedFields = ["credentials"]` + `details.mustChangePassword` at the REAL-DB layer; the census row (`ADMIN_ACTION_CENSUS` + `USER_LIFECYCLE_LEG`, `expectedActionTypes: [AuditActionType.Update]`) must reconcile with that — one wired mutation, one row, zero orphan writes. This journey's cast-scoped audit-count helper (`countAuditRowsForCast`: actorId OR user-entity scope) is the parallel-suite-safe counting pattern if the census test needs a delta probe.
- **Task 14:** baselines — `bun tsgo` 0 errors; sub-loop exit 0 on the new file; both precedent journeys re-run green. This task's diff is exactly the one journey file + plan-dir/worklog writes; the shared worktree also carries the other tasks' artifacts (Tasks 0–10, 13 etc.) — not this task's.
- **Gate seam names (exact):** `isPasswordChangeRequired(user, rootFieldNames)`, `extractOperationRootFieldNames(operation, document)`, `isExemptRootField(name)`, `PASSWORD_CHANGE_EXEMPT_ROOT_FIELDS` (frozen, 7 names), `buildPasswordChangeRequiredDenial(msg)` in `backend/graphql/passwordChangeGate.ts`; the plugin factory `createPasswordChangeGatePlugin()` needs a full Apollo request context and was deliberately NOT invoked here (the unit tier pins its registration surface). The deny path is Apollo-only — services never read the flag; any future service-level fence would be a new plan decision.
- **Cleanup seam for journeys with audit rows:** delete `audit_logs` (actorId IN ids OR `entity_type='user'` AND entity_id IN ids) FIRST under `withAuditDeleteTriggersSuspended` (from `@/test/helpers/db-cleanup`), then `TrackedFixtures.cleanup()` — never track `audit_logs` in the registry (trigger-immutable tables are residue-probed, not tracked).
- **Actor relabel pattern:** when a task mandates a `jrn_<domain>_<8hex>` prefix but the actor-context factory generates its own emails, relabel inside the SAME provisioning transaction with an explicit field-mapped `users` update (this journey's `relabelActorFixture`) — keeps honest provisioning AND the prefix contract without touching the shared helper.
- Test-DB prerequisites held: `must_change_password` column live in `kottaby_test` (Tasks 1/2/4-fix), seed users present; no schema/seed operations were needed.

## 7. Cross-File Dependencies

- None open. Task 12 must register `adminSetUserPassword` in the audit census (its file scope, not this one); Task 14 consumes the baselines above. The journey file is self-contained (no helper additions), so nothing downstream is blocked by this task.
