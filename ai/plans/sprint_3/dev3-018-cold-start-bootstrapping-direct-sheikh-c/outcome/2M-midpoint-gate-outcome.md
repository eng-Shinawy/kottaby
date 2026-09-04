# Task 2.M Outcome — Mid-Point Review Gate

**Date:** 2026-09-01
**Role:** verification plus hygiene gate for Phase 2 (tasks 2.1–2.5); no authoring, no source/test edits
**Requirements:** REQ-001/002/003, REQ-010..019, REQ-030..034, REQ-040..050, REQ-051/052, REQ-070..075, REQ-076

---

## VERDICT: PASS — F-1 RESOLVED (see §1a below)

Every DEV3-018 deliverable verified green and plan-conformant, and the F-1
regression-lock failure is now resolved and re-verified green.

### 1a. F-1 Resolution (recorded 2026-09-01, same day as the initial run)

- **Root cause:** the local `.env` `DATABASE_URL` pointed at a schema-stale /
  unseeded scratch database (`session-request-notification-to-teacher`, `users`
  count = 0) instead of the seeded canonical local DB (`kottaby_test`), whose own
  schema had additionally drifted behind the drizzle schema (missing
  `users.locale` and other columns).
- **Fix (user-authorized environment repair):** `.env` `DATABASE_URL` re-pointed
  at `kottaby_test`; `bun db push` applied against `kottaby_test` to close the
  schema drift. NO schema/migration files were changed —
  `git diff --stat -- backend/db/schema/ backend/db/migration/` remains **EMPTY**
  (re-verified by this gate after the fix).
- **Independent re-verification by this gate after the fix** (sanctioned runner
  only):
  - `bun run test/scripts/run-test.ts backend/services/admin/user-management.service.test.ts`
    → **exit 0, 61 pass / 0 fail, 236 expect() calls** (regression lock green again)
  - `bun run test/scripts/run-test.ts test/workflows/admin/cold-start-certification.journey.test.ts`
    → **exit 0, 12 pass / 0 fail, 193 expect() calls**
  - `grep -c "❌\|⚠️" deferred-items.md` → **0** (ledger glyph gate intact)
- F-1 is therefore closed: HIGH-evidence finding discharged; it was never a
  DEV3-018 code defect, and the §1 table's row 5 is superseded by these re-runs.

**The `2.M` checkbox in `tasks.md` is FLIPPED to `[x]` by this gate.**

---

## 1. Command results (re-run verbatim by THIS gate, today)

| # | Command | Exit | Result |
|---|---------|------|--------|
| 1 | `bun tsgo` | 0 | 0 TypeScript errors repo-wide (baseline 0 preserved; no `error TS` lines) |
| 2 | `bun run test/scripts/run-test.ts test/workflows/admin/cold-start-certification.journey.test.ts` | 0 | **12 pass / 0 fail**, 193 expect() calls |
| 3 | `bun run test/scripts/run-test.ts backend/services/admin/cold-start-certification.service.test.ts` | 0 | **27 pass / 0 fail**, 160 expect() calls |
| 4 | `bun run test/scripts/run-test.ts backend/services/admin/admin-gate.helpers.test.ts` | 0 | **10 pass / 0 fail**, 33 expect() calls |
| 5 | `bun run test/scripts/run-test.ts backend/services/admin/user-management.service.test.ts` | 1 | **60 pass / 1 fail**, 230 expect() calls — regression lock NOT green (see F-1) |
| 6 | `bun run test/scripts/run-test.ts backend/services/admin/user-management.chaos.test.ts` | 0 | **8 pass / 0 fail**, 46 expect() calls |
| 7 | `bun run test/scripts/run-test.ts backend/db/repo/teachers/teacher.repository.test.ts` | 0 | **10 pass / 0 fail**, 54 expect() calls |
| 8 | `bun run test/scripts/run-test.ts backend/db/repo/teachers/applicant.finalize.test.ts` | 0 | **7 pass / 0 fail**, 34 expect() calls |
| 9 | `bun run test/scripts/run-test.ts backend/db/repo/teachers` (whole dir) | 0 | **17 pass / 0 fail** across the two files |

Command 5 was run THREE times total (once in the initial parallel wave, twice
serially afterwards to exclude cross-runner interference): same failure each time,
so parallel interference is excluded.

### F-1 failure tail (verbatim, latest run)

```
392 |       await createTestStudent(tx, student.id);
393 |
394 |       const stats = await AdminUserManagementService.getStats(LOCALE, admin.id, tx);
395 |
396 |       // The provisioned admin + student are observable on top of the seed rows.
397 |       expect(stats.totalCount).toBeGreaterThanOrEqual(6);
                                     ^
error: expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 6
Received: 2

1 tests failed:
(fail) AdminUserManagementService.getStats > happy path — admin reads the overview counters; role counters partition totalCount exactly [18.75ms]

 60 pass
 1 fail
 230 expect() calls
Ran 61 tests across 1 file. [3.09s]
```

### F-1 root-cause evidence chain

1. The failing assertion is seed-dependent ("on top of the seed rows");
   `Received: 2` = exactly the two in-test fixtures, zero seed users visible.
2. `backend/db/lib/env.ts` (`applyDbEnvOverride`, lines 30–44) force-loads the
   DB keys from `.env` over any other source, so every DB test connects to the
   `.env` database regardless of `.env.test`.
3. A diagnostic probe test (created by this gate, run via the sanctioned
   runner, then deleted) executed `current_database()` inside both the direct
   pool and a `runInRollback` transaction: BOTH returned
   `dbname = "session-request-notification-to-teacher"` with `user_count = 0`.
4. The seeded test database DOES exist and is intact:
   `psql … kottaby_test → users: total=42 (admins 4, students 20, teachers 12, parents 6)`.
   Against that database the failing assertion (`totalCount >= 6` etc.) would hold.
5. Attribution: `git diff HEAD -- backend/services/admin/user-management.service.ts
   backend/services/admin/user-management.service.test.
   backend/db/repo/admin/admin-user.repository.ts` is EMPTY; `git log` shows the
   test file last touched by the DEV3-016 commit `7449297`. No DEV3-018 file
   touches `getStats`, the `users` table read path, or seed data. The 2.4
   outcome (same day, hours earlier) recorded 61/61 green — the environment
   changed between then and now (`.env` is untracked, machine-local, and shared
   with other in-flight work in this tree).

**Conclusion:** not a DEV3-018 defect; the sibling `getStats` suite is a victim of
the shared working tree's current `.env` pointing at an unseeded branch database.
Severity: HIGH for gate evidence (a mandated regression lock cannot be attested);
severity ZERO for the code under review. This gate does NOT edit `.env`, does NOT
seed a foreign feature database, and did NOT modify any source or test file
(temporary probe file `test/helpers/gate-probe-2m-diag.test.ts` and its log
artifact were deleted after use).

---

## 2. Plan-vs-actual conformance (plan.md §4 decision register), verified from CODE

| Decision | Verdict | Evidence (file:line) |
|----------|---------|----------------------|
| D1 — actor gate WITH governance, pre-transaction | HONORED | `backend/services/admin/cold-start-certification.service.ts:170` — `assertActorAdminActive(actorId, locale, outerTx)` runs BEFORE `withTransaction` opens (`:182`); gate body at `admin-gate.helpers.ts:105-136` (role gate reused, governance order deleted→blocked→suspended, one bounded `logDomainError` per denial) |
| D2 — two guarded write shapes | HONORED | `backend/db/repo/teachers/teacher.repository.ts:118-133` — `elevateToCertified` folds `is_approved = false` into the UPDATE WHERE (atomic guard, zero-row → `null`); insert path `:85-103` plain INSERT surfacing raw 23505. Service branch at `:115-152`: row absent → insert with cause-checked 23505 translation via `isUniqueViolation` (`:121-131`, non-unique rethrows untouched); `isApproved === true` → immediate `TEACHER_ALREADY_CERTIFIED` conflict (`:134-137`); elevate → zero-row cold re-read disambiguation (`:139-152`) |
| D4 — publish strictly post-commit | HONORED | `cold-start-certification.service.ts:237` — `NotificationEngine.publishReceipts` sits AFTER `withTransaction` resolves; in-tx emit at `:216-228` returns receipt narrowed by `asDeliveryReceipt` (`:95-100`); a throw anywhere in the tx makes publish structurally unreachable |
| D6 — shared gate consumed-and-extended, no private copy | HONORED | `user-management.service.ts:65` imports `assertActorAdmin` from `admin-gate.helpers`; seven call sites (`:118,157,193,231,271,342,395`); NO private function definition remains (grep-verified). `assertActorAdminActive` appended as a NEW function only (`:105-136`), `assertActorAdmin` untouched |
| D7 — `makeEvaluator` coalesce | HONORED | `cold-start-certification.service.ts:180` — `const makeEvaluator = input.makeEvaluator ?? true;` |
| D8 — audit details = exactly 3-field JSON | HONORED | `cold-start-certification.service.ts:207-211` — `JSON.stringify({ makeEvaluator, applicantRow: applicantFinalized ? "finalized" : "absent", elevation })`; single `AuditService.createAuditLog` call with `actionType: AuditActionType.Override`, `entityType: "teacher"`, `entityId: userId` |
| D12 — notification copy in the ADMIN's locale | HONORED | `:172` `getServerTranslations(locale)` bound to the call's locale (the actor's), used at `:220-221` `t.applicantTranslations.coldStartCertifiedTitle / coldStartCertifiedBody` |
| One `createAuditLog` per commit | HONORED | single call site `:201-214`, inside the tx, after all writes, only on the success path |
| ZERO audit rows on denial (JR-C-1) | HONORED | every denial throws before the audit line; the 27-test service suite pins zero-audit oracles per denial (run #3 green) |
| Single transaction boundary / no mixed tx·db | HONORED | exactly ONE `withTransaction(outerTx, tx => …)`; the same `tx` threads `UserRepository.findById`, `certifyTeacherRow`, `finalizeOnCertification`, `createAuditLog`, `emitForUser`, `getUserDetail`; `outerTx` only seeds the gate + boundary |
| Typed error taxonomy (D10/D11 as baked into the code) | HONORED | closed set `ValidationError` / `NotFoundError("USER")` / `ConflictError(code, message)` overload only (`:176,186,190,194,128,136,150`); no new subclasses; only one try/catch (23505 translation) |

## 3. Journey coverage spot-check (12 tests + afterAll teardown vs J-1, 13 steps)

Confirmed by the live run's test names and the assertions observed in-file:

1. cast committed — TEST 1 ✅
2. create (users + applicants pending + ONE audit, zero teacher rows) — TEST 2 ✅
3. certify (certified teacher + finalized applicant + ONE override audit + ONE notification + ONE spied envelope) — TEST 3 ✅
4. cross-actor visibility (target inbox shows row; Admin B + student inboxes EMPTY; trio oracle) — TEST 4 ✅
5. Admin B observer (detail + activity, attribution to Admin A) — TEST 5 ✅
6. governed actor denial (student) — TEST 6 ✅
7. suspended-admin governance denial — TEST 7 ✅
8. non-teacher target → TEACHER_ROLE_REQUIRED — TEST 8 ✅
9. governed target → TEACHER_ACCOUNT_GOVERNED, then reactivation composition succeeds — TEST 9 ✅
10. repeat call → TEACHER_ALREADY_CERTIFIED, audit pinned at 2, no second envelope — TEST 10 ✅
11. cooldown supersession (failed + future cooldown → passed, cooldown null) — TEST 11 ✅
12. elevation (unapproved row + makeEvaluator:false → approved non-evaluator, audit `elevated`/applicantRow `absent`) — TEST 12 ✅
13. teardown + zero-residue oracle — afterAll tracked cleanup with audit-delete-trigger suspension (not a numbered test; per 2.1 outcome) ✅

**Uncovered steps: NONE.** All nine assignment-listed behaviors (create, governed actor,
non-teacher target, governed-target→reactivate composition, repeat-call conflict,
cooldown supersession, elevation, cross-actor visibility, teardown residue) are
asserted in the green run. The journey was NOT edited by this gate.

## 4. Hygiene results

- Schema drift: `git diff --stat -- backend/db/schema/ backend/db/migration/` → **EMPTY** ✅
- Ledger glyphs: `grep -c "❌\|⚠️" deferred-items.md` → **0** ✅
- `console.*` in all nine new/changed src+test files (service, service test, gate, gate test,
  teacher repo, repo test, finalize test, changed applicant repo, journey) → **zero matches** ✅
- `git diff --name-only` / `git status --short` expected file set verbatim:
  - `backend/types/teachers/teacher.types.ts`
  - `shared/locale/types/errors/index.ts`, `shared/locale/en/errors/index.ts`, `shared/locale/ar/errors/index.ts`
  - `shared/locale/types/applicant/index.ts`, `shared/locale/en/applicant/index.ts`, `shared/locale/ar/applicant/index.ts`
  - `backend/db/repo/teachers/teacher.repository.ts` (new), `backend/db/repo/teachers/index.ts`,
    `backend/db/repo/teachers/teacher.repository.test.ts` (new),
    `backend/db/repo/teachers/applicant.repository.ts`, `backend/db/repo/teachers/applicant.finalize.test.ts` (new)
  - `backend/services/admin/admin-gate.helpers.ts`, `backend/services/admin/admin-gate.helpers.test.ts` (new),
    `backend/services/admin/index.ts`,
    `backend/services/admin/cold-start-certification.service.ts` (new),
    `backend/services/admin/cold-start-certification.service.test.ts` (new)
  - `test/workflows/admin/cold-start-certification.journey.test.ts` (new)
  - plan dir: `tasks.md`, `deferred-items.md`, `outcome/{0-baseline,0.2,1.1,1.2,plan-review-R1,2.1,2.2,2.3,2.4,2.5}` (+ this file)
- **FOREIGN entries (flagged, not touched):**
  - `.gitignore` — modified (adds a `node_modules` line); not part of this ticket's file set
  - wholesale deletion of `ai/plans/sprint_1/dev2-004-teacher-applicant-registration-applicant/**`
    reappearing under `ai/finished_plans/sprint_1/…` — a plan-archival move by another actor
  Both predate this gate and belong to concurrent in-flight work in the shared tree.
  Neither affects DEV3-018's scope; recorded for the orchestrator's awareness.
- Staging state is mixed (some DEV3-018 files staged, some unstaged) — informational only; no git
  mutations performed by this gate.

## 5. Checkbox audit (tasks.md, read-only)

All flipped as required through Phase 2:
- `[x]` 0.1, 0.2 (+ 0.2.QL/SR), 1.1 (+ QL/SR/IV), 1.2 (+ QL/TE/SR/IV), 1.9
- `[x]` 2.1–2.5 INCLUDING every subtask (2.1.QL/TE/SEC/SR/IV … 2.5.QL/TE/SEC/SR/IV)
- `[ ]` 2.M (this gate; per verdict left unflipped), and all 3.x–7.x tasks `[ ]` — correct state

No `[ ]` stragglers inside tasks 1.1–2.5.

## 6. Findings

| ID | Severity | Finding |
|----|----------|---------|
| F-1 | ~~HIGH (evidence-blocking)~~ **RESOLVED** (see §1a) | DEV3-016 regression lock failed on an environment defect: `.env` pointed at the scratch DB `session-request-notification-to-teacher` (users = 0) while the canonical `kottaby_test` schema had drifted behind the drizzle schema. After the user-authorized fix (re-point `.env` + `bun db push` on `kottaby_test`), this gate independently re-ran the lock suite: **61 pass / 0 fail**, plus the journey re-run **12 pass / 0 fail**, schema-diff still empty. Not a code defect. |
| F-2 | LOW | Foreign tree mutations present: `.gitignore` (`+node_modules` line) and the dev2-004 sprint-1 plan-dir archival move. Not in DEV3-018's expected file set; no action taken. |
| F-3 | LOW | Earlier outcomes note stale instruction-path mapping in sub-loop output (`.github/instructions/…` vs `.agents/instructions/…`) — carried from 0.2/plan-review findings; unchanged at this gate. |

## 7. Gate disposition

- Verdict **PASS** (updated from FAIL after F-1 resolution §1a): every mandated command
  re-run green today, including both re-verifications of the previously failing lock
  suite; conformance, coverage, hygiene, and zero-drift all pass.
- `tasks.md` `- [ ] 2.M` line **FLIPPED to `[x]`** by this gate (only that line).
- No source, test, schema, migration, or shared-layer file was modified by this gate.
  The ONLY filesystem touch besides this outcome file was a self-deleted diagnostic
  probe (`test/helpers/gate-probe-2m-diag.test.ts` + one log artifact).
- Phase 3 (task 3.1) is unblocked.

## Files Changed

- CREATED `ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c/outcome/2M-midpoint-gate-outcome.md` (this file)

## Deviations

- None. Read-only mandate honored; the temp diagnostic probe was the minimal possible
  intrusiveness to prove F-1 attribution and was deleted immediately after use.
