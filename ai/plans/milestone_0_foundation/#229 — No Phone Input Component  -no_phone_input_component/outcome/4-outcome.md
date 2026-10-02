# Task 4 Outcome — Cross-actor registration journey test (TEST-FIRST)

**Task:** 4 — Cross-actor registration journey test (`REQ-6.4`, `REQ-4.4`, `REQ-9.1`, `REQ-9.2`)
**File created:** `test/workflows/auth/registration-phone.journey.test.ts` (NEW domain subdirectory `test/workflows/auth/`, permitted by `test/workflows/AGENTS.md` rule 10)
**Pipeline:** 4.QL ✅ (exit 0) · 4.TE ✅ · 4.SEC ✅ · 4.SR ✅ · 4.IV ✅
**Run mode:** TEST-FIRST — authored before Tasks 6–7 wire the shared helper into `registration.service.ts` / `user-management.helpers.ts`.

---

## 1. What was built

A single journey file implementing the plan's §Cross-Actor Journey Capture (Journey J1) 1:1 — 9 ordered, actor-attributed steps through the REAL services (`RegistrationService.registerUser`, `AdminUserManagementService.createUser`/`updateUser`, `StudentOnboardingService.onboardStudentWithOfflinePayment`) against the real `kottaby_test` Postgres. Harness per `test/workflows/AGENTS.md`:

- **NO `runInRollback`** — committed fixtures in `beforeAll` inside ONE committing `db.transaction` (actors via the actor-context factory `provisionAdminActor` / `provisionStudentActor`; the lane-bearing onboarding plan via `createTestPlan`, registered in a `TrackedFixtures` registry).
- **Tracked cleanup** — every created user id/email goes onto `createdIds`/`createdEmails` (cast + every service-minted row); `afterAll` = `deleteUsersByIds(createdIds)` (audit sweep under `withAuditDeleteTriggersSuspended` → RESTRICT-gated `subscriptions`/`evaluations` → `users`, role children cascade) → `tracked.cleanup()` (plan row, reverse order, zero-residue re-probe) → explicit `expect(…)=0` probes over `users`/`students`/`applicants`/`parents`/`subscriptions`/`audit_logs`. Independent `psql` verification after EVERY run: **0 rows** in all seven tables.
- **RED-mode leak discipline** — under the pre-wiring contract the invalid-phone calls RESOLVE and commit rows; each such call's payload is tracked for teardown BEFORE the failing assertion (`attemptServiceCall` returns the resolved value + the caught `DomainError`; `expectDomainRejection` fails with a descriptive message). Three full runs + the independent DB sweeps confirm zero leakage.
- **Notification boundary spied, never hit** — passthrough `spyOn` on `NotificationEngine.emitForUser`/`emitForUsers`/`publishReceipts` (recitation-record precedent), re-armed per step (`afterEach`), restored in `afterAll`; every step ends with `expectZeroDispatches()` (none of these flows owns a dispatch — asserted, not assumed).
- **Honest authorization** — actors are real users with real roles; the Guest denial uses the documented `ANONYMOUS_ACTOR_ID` sentinel, the non-admin denial uses the fixture student's real `users.role="student"`; both fail through the real `assertActorAdmin` ladder (`UnauthorizedError` / `ForbiddenError`). No monkey-patching anywhere.
- **No `console.*`, no PII (synthetic `jrn_auth_<8hex>` fixtures only), no production time-mock, no new deps, `bun:test` imports, `@/` aliases, deep `@/test/helpers/db-cleanup` import (barrel pulls Apollo into backend graphs).**

## 2. Observed RED/GREEN matrix (my runtime — mandated runner, 3 consecutive runs, matrix stable)

Run command: `bun run test/scripts/run-test.ts test/workflows/auth/registration-phone.journey.test.ts` (NEVER raw `bun test`).

| Step | Actor → action | Expectation | Observed | Why |
|---|---|---|---|---|
| 1 | Guest → `registerUser` phone `""` | reject `fields[0].code === "PHONE_REQUIRED"`, msg `authTranslations.phoneRequired`, no row | **GREEN** | pre-wiring `validateInput` (`registration.service.ts:213-215`) already emits it |
| 2 | Guest → `registerUser` phone `"12345"` | reject `PHONE_INVALID` | **RED** (expected) | call RESOLVES + commits a user row — helper not wired into registration yet (Task 6) |
| 3 | Guest → `registerUser` 17-char phone | reject `PHONE_TOO_LONG`, msg `errorsTranslations.validation` | **RED** (expected) | registration has NO length/format check pre-wiring (legacy 20-bound lives only in admin helpers) |
| 4 | Guest → `registerUser` `+201234567890` | SUCCESS; response carries id; `users.phone` persists submitted value | **GREEN** | — |
| 5 | Guest → Student/Teacher/Parent replay | SUCCESS ×3 + role-child rows (`students`/`applicants`/`parents`) | **GREEN** | same rule for every registrant |
| 6 | Admin → `createUser` `"12345"` | reject `PHONE_INVALID`, no row | **RED** (expected) | `validateCreateInput` checks only required/length>20 (Task 7 wiring pending) |
| 7 | Admin → `createUser` valid → SUCCESS; `updateUser` 17-char + smuggled `role`/`isBlocked` → reject `PHONE_TOO_LONG`, zero writes, no mass-assignment; valid phone-only patch writes ONLY `phone` | | **RED** (expected) | 7a create GREEN; 7b too-long update RESOLVES (17 ≤ legacy 20) — helper wiring pending; 7c/7d probes are behind 7b |
| 8 | Admin → onboarding invalid phone | inherited `PHONE_INVALID` via `createUser` delegation, nothing persists | **RED** (expected) | onboarding delegates to unwired `createUser` — resolves + commits user/students/subscription/audit rows (all leak-tracked, all swept) |
| 9 | Guest (`actorId=0`) + real non-admin → `createUser` | DENIED `UNAUTHORIZED` / `FORBIDDEN`, zero writes, cast rows byte-identical | **GREEN** | real `assertActorAdmin` ladder exists at baseline |

Run output tail (3rd run):

```
(pass) … step 1 — Guest: registerUser with an empty phone is rejected with PHONE_REQUIRED; no row persists [3.87ms]
(fail) … step 2 — Guest: registerUser with a non-E.164 phone is rejected with PHONE_INVALID; no row persists [508.91ms]
  error: expected a domain rejection, but the service call resolved successfully — test-first RED (validation wiring not landed) or contract regression
(fail) … step 3 — Guest: registerUser with a 17-char phone is rejected with PHONE_TOO_LONG and the errors.validation copy [287.12ms]
(pass) … step 4 — Guest: registerUser with a valid E.164 phone succeeds; users.phone persists the submitted value [286.68ms]
(pass) … step 5 — Guest: the same rule admits Student, Teacher, and Parent registrants with valid phones [856.79ms]
(fail) … step 6 — Authenticated Admin: createUser with a non-E.164 phone is rejected with PHONE_INVALID; no row persists [295.46ms]
(fail) … step 7 — Authenticated Admin: createUser succeeds; a too-long update is rejected, writes nothing, and smuggled fields are never mass-assigned [300.09ms]
(fail) … step 8 — Authenticated Admin: student onboarding with an invalid phone is rejected with the inherited PHONE_INVALID; nothing persists [305.39ms]
(pass) … step 9 — Guest and non-admin callers are DENIED admin createUser through the real authorization gate; zero writes [3.48ms]
 4 pass / 5 fail / 46 expect() calls
```

All 5 failures are the SAME shape — the denial did not fire because the service accepted the invalid phone — i.e. the CORRECT test-first RED state per the run-mode note. Steps 2/6/8 additionally prove (GREEN-side) the "no row persisted" half of EARS 2/3; in RED mode the committed rows are leak-tracked and swept (verified 0 residue by `psql` after every run).

## 3. 4.QL — Quality Loop

`bun run scripts/health/sub-loop.ts test/workflows/auth/registration-phone.journey.test.ts --lifecycle duplicates` → **exit 0**: oxlint ✅, biome:check ✅, lint:type-aware ✅, check:duplicates skipped (file outside jscpd scan scope) ✅. The sub-loop's project-wide tsgo stage reported "no errors for this file" — BUT a tsgo process was OOM-killed in this window (dmesg: `Out of memory: Killed process 20455 (tsgo) … anon-rss:3001184kB`; the check is memory-borderline per Task 0-A2/Task 3) and a concurrent subagent's sub-loop was running simultaneously, so the tsgo line alone cannot be treated as proof. **Non-vacuous type gate (Task-3 fallback pattern):** scoped tsconfig OUTSIDE the repo (extends root tsconfig, `typeRoots` pinned into the repo's `node_modules/@types`, include = exactly the journey file) → `bunx tsgo -p … --noEmit` produced REAL diagnostics for the graph (proving the gate engages) and **ZERO diagnostics for the journey file itself**. The only diagnostic belongs to the concurrent agent's in-flight `backend/services/shared/phone-validation.helpers.ts:51` (`phoneInvalid` missing on `AuthLabels` — Task 5's file awaiting Task 3's key; NOT my file, not fixed by me per the fix-or-report rule). Scratch tsconfig deleted afterwards.

## 4. Security & tenancy audit (4.SEC)

- **REQ-9.1** — the journey drives the server boundary directly (crafted service calls, no client in the loop); the GREEN steps 1/9 and RED steps 2/3/6/7/8 demonstrate the trust boundary must own the phone rule; the suite fails (RED) wherever the boundary does NOT reject — exactly the regression signal the plan wants pre-wiring.
- **REQ-9.2 (BOPLA)** — step 7 smuggles `role: "admin"`, `isBlocked: true` into an update patch via `Object.assign` (no `any` casts): the whitelist must drop them, the too-long phone must reject, and the row must stay byte-identical on failure; the follow-up valid phone-only patch must change ONLY `phone`. Step 9 proves the write path is unreachable for non-admins (BFLA honest resolution, zero writes, cast rows byte-identical).
- **REQ-9.3** — every phone-denial assertion includes `message` NOT containing the hostile input.
- **Actor identities** — fixture-created users only (actor-context factory) + the documented `ANONYMOUS_ACTOR_ID=0` sentinel; zero monkey-patching; no seed/demo rows.

## 5. Semantic review (4.SR)

Harness per rulebook (rules 1–12 as listed in §1); no PII (synthetic values only); no `console.*`; no production time-mock; cleanup is REAL hard-delete (no rollback wrapper) with load-bearing zero-residue probes; no new dependencies; no `any` (Object.assign intersection for the tampered patch); helpers are file-local and ≤ ~40 lines each; docblock documents the TEST-FIRST expectation and the actor/step matrix. Idempotent-teardown proof: the suite ran THREE consecutive times over the same DB — identical matrix, zero residue after each.

## 6. Instruction verification (4.IV)

Read IN FULL before authoring: root `AGENTS.md`, `test/workflows/AGENTS.md` (the journey rulebook), `.agents/instructions/tests.instructions.md`; sub-loop re-printed `tests.instructions.md` + root `AGENTS.md` for this file (both already absorbed). Plan artifacts: `tasks.md` (protocol + Task 4 block), `specs.md` (REQ-6.4/4.4/9.1/9.2 + §Cross-Actor Journey Capture), `deferred-items.md`, `outcome/plan-review-R1.md`, `outcome/9-outcome.md`, `outcome/10-outcome.md`, `worklog.md` (Tasks 0/1/3/8). Precedents read: `admin-user-lifecycle.journey.test.ts`, `direct-student-onboarding.journey.test.ts`, `recitation-record.journey.test.ts` (dispatch-spy pattern), helpers (`tracked-fixtures.ts`, `journey-cleanup.ts`, `actor-context.ts`, `journey-actor-fixtures.ts`, `spied-transport.ts`), `db-cleanup.ts`. Services read end-to-end before testing: `registration.service.ts`, `user-management.service.ts`, `user-management.helpers.ts`, `student-onboarding.service.ts` + helpers, `admin-gate.helpers.ts`, `registration.types.ts`, `errors.ts`.

## 7. Environment facts observed in this window (carry-forward)

- **Concurrent-agent drift:** the worklog recorded Tasks 1/3/8 as complete, but at window start the tree was PRISTINE at `5a8369fe` (HEAD `main`, no `shared/lib/phone.ts`, no `phoneInvalid` key) — their artifacts only landed mid-window (by run 3: `shared/lib/phone.ts` + test, `phone-validation.helpers.ts` + test, `backend/services/shared/index.ts` modified, `PhoneInput.stories.tsx`, outcome 9/10 files). My matrix reflects the tree as observed per run; registration/admin wiring (`registration.service.ts`, `user-management.helpers.ts`) was NOT modified in my window.
- A1 branch anomaly still open: HEAD on `main`; orchestrator must `git switch feat/no-phone-input-component` before committing (my file is untracked-new, so it carries over).
- Full-repo tsgo OOM reproduced again in this window (see §3) — keep using the scoped-tsgo fallback for per-file type evidence.

## 8. Carry-forward for Tasks 5/6/7/16

- **Task 6 (registration wiring):** steps 2 + 3 flip GREEN when `validateInput:213-215` routes through `validatePhoneField`. The journey pins: `PHONE_INVALID` (any shape failure), `PHONE_TOO_LONG` at **17 chars** with message `errorsTranslations.validation`, top-level `error.message === fields[0].message` (entries[0] contract), and message-never-echoes-input. Note for the mapping: step 2 intentionally does NOT pin the `PHONE_INVALID` message text (only the code + no-echo), so the `authTranslations.phoneInvalid` mapping is free.
- **Task 7 (admin wiring):** steps 6 + 7b flip GREEN when `validateCreateInput`/`validateUpdatePatch` route through `validatePhoneField` (update keeps the `typeof patch.phone === "string"` non-empty guard; 17 chars is the rejection boundary the journey pins — the legacy `MAX_PHONE_LENGTH=20` path accepted it). Onboarding step 8 needs NO code (asserts the inherited rejection through `createUser`).
- **Task 16 (final gate):** after Tasks 6+7 land, `bun run test/scripts/run-test.ts test/workflows/auth/registration-phone.journey.test.ts` must be 9/9 GREEN, then `bun run test`. The suite is currently expected 4-pass/5-fail — that is the documented test-first state, NOT a defect.
- **Task 5 note (cross-file, not mine):** `phone-validation.helpers.ts:51` currently references `authTranslations.phoneInvalid`, which is absent from the tree in my window (Task 3 artifacts landed after?) — scoped tsgo flags TS2339. If Task 3's key is present in the final tree this resolves; otherwise Task 16's tsgo gate will catch it.
