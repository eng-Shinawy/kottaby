# Task 2 Outcome — `ApplicantRepository.extendCooldownOnce` + Repo Tests

> **Date:** 2026-09-27 · **Ticket:** `docs/planning/TICKETS.md:818-868` (T2-008 — Dev 2 · M1 · 5 SP)
> **Plan directory (verbatim):** `ai/plans/milestone_1_core_domain_mvp/cooldown_state_machine_1_month_tajweed_3_month_hifz/`
> **Specs:** `specs.md` (REQ-007, REQ-006, REQ-003) · **Design:** `plan.md` §5.2 (+ §6 concurrency discipline) · **Task def:** `tasks.md` Phase 1
> **Scope guard:** Task 2 touched ONLY the applicant repository (+ its new repo-test suite) and the plan's own tracking files (`tasks.md` checkboxes, this outcome). No `git commit` (orchestrator-owned).

---

## 1. Files created / modified

| File | Change | Evidence |
|---|---|---|
| `backend/db/repo/teachers/applicant.repository.ts` | APPEND (+52 lines, single hunk `@@ -530,0 +531,52 @@`) — `extendCooldownOnce(userId: number, newExpiry: Date, tx: DBTransaction): Promise<ApplicantSelectType | null>` appended as the last method of the `ApplicantRepository` namespace (after `finalizeOnCertification`). Guarded single-statement UPDATE: `.set({ cooldownUntil: newExpiry, updatedAt: sql\`now()\` })` WHERE `and(eq(applicants.id, userId), inArray(applicants.status, [ApplicantStatus.Pending, ApplicantStatus.InEvaluation, ApplicantStatus.Failed]))` → `.returning()` → `row ?? null`. Import block UNTOUCHED — `ApplicantStatus` was already a VALUE import (`@/backend/enum`), `sql`/`and`/`eq`/`inArray` already imported from `drizzle-orm`; no new import of any kind (the file's pre-existing `users` import serves the pre-existing `listDirectory`/`statusCounts` methods only). |
| `backend/db/test/repo/teachers/applicant.repository.test.ts` | CREATE — dedicated `describe("ApplicantRepository.extendCooldownOnce")` suite: 10 behavioral tests + 7 static source pins = **17 tests / 56 expects**, mirroring `applicant.repository.transition.test.ts`'s tier discipline (T1 branch, T2 boundary, T4 hostile + static pins; helpers `absentApplicantId`/`readApplicantRow` re-created locally per the file-scoped helper convention). |

### Plan-drift resolution (test-file name)

The plan's file list names `backend/db/test/repo/teachers/applicant.repository.test.ts`, which did NOT exist on disk — the blocker ticket's applicant repo suite is `applicant.repository.transition.test.ts` (its own name reflects its `transition*`/`findForBookingGate` scope). The plan path was made to exist verbatim: the new suite lives at the plan-named path, keeping Tasks 5/8/9 review scopes (`tasks.md:16,186`) and the env-brief's test invocation pointing at a real file. The transition suite was NOT modified (zero risk to its whole-file static pins — re-run green, §3).

## 2. Method contract (what shipped)

- **Guarded admission control:** the eligible pre-states ARE the WHERE predicate (`pending | in_evaluation | failed`) — no read-then-write, no service-tier re-check needed for the terminal guard. A `passed` (certified) applicant and a missing id both match zero rows → `null` (the service tier disambiguates: `APPLICANT_ALREADY_CERTIFIED` vs `APPLICANT_NOT_FOUND`).
- **Verbatim instant:** `cooldown_until` is stored exactly as the caller passes it (`newExpiry`); the repo performs NO duration arithmetic — `max(currentCooldownUntil, now) + additionalDays` is service-layer computation (the extension "expired/NULL base" semantics live there; the repo just overwrites, proven by the expired-base test).
- **Column discipline:** writes ONLY `cooldownUntil` + `updatedAt` (DB-side `now()`); never touches `status`, attempt counters, or any other table's columns.
- **`tx` REQUIRED (tx-last):** mirrors `transitionToFailed`'s guarded-predicate discipline per plan §6 — no standalone global-handle branch, no bare-reads fallback (this is a write; the method exists solely inside the caller's admin transaction).
- **Parameterization:** `eq`/`inArray` bind values; the three `ApplicantStatus` members are enum VALUES (never string literals, never concatenated); `sql\`now()\`` is a constant fragment — zero interpolation, zero inline `--` SQL comments, no prepared statement (writes excluded).

## 3. Verification results

| Gate | Command | Result |
|---|---|---|
| 2.QL | `bun run scripts/health/sub-loop.ts backend/db/repo/teachers/applicant.repository.ts --lifecycle duplicates` | ✅ exit 0 (tsgo → oxlint → biome:check → lint:type-aware → check:duplicates all green) |
| 2.QL | `bun run scripts/health/sub-loop.ts backend/db/test/repo/teachers/applicant.repository.test.ts --lifecycle duplicates` | ✅ exit 0 (per-file invocation — the script is SINGLE-FILE ONLY; check:duplicates skipped-by-design for `*.test.ts`, outside jscpd scan scope) |
| 2.TE | `bun run test/scripts/run-test.ts backend/db/test/repo/teachers/applicant.repository.test.ts` | ✅ **17 pass / 0 fail** / 56 expects |
| 2.TE (regression) | `bun run test/scripts/run-test.ts backend/db/test/repo/teachers/applicant.repository.transition.test.ts` | ✅ 32 pass / 0 fail — the sibling suite's whole-file static pins (`.prepare(`-free, plan-artifact-free comments) still hold over the appended method |
| 2.TE (coverage) | `KOTTABY_TEST_RUNNER_OK=1 bun test --coverage backend/db/test/repo/teachers/applicant.repository.test.ts` (run-test has no coverage mode; this is the guard's documented debug bypass) | ✅ `extendCooldownOnce` has ZERO uncovered line ranges in the coverage table (every other method's ranges are listed as uncovered by this single-method suite and are owned by the transition/logic suites) — 100% lines+branches for the new method: both `row ?? null` arms exercised |
| Typecheck | `bun tsgo` | Exactly the 2 PRE-EXISTING Task-1 carry-over errors (`user-management.mappers.ts:120`, `applicant-lifecycle.service.ts:168` — both assigned to Task 4). ZERO new errors from Task 2. |

### Two-source-split grep proof (the 2.SEC/REQ-006.2 gate)

- `rg "users.suspended|users\.suspended|suspendedPeriodDays" backend/db/repo/teachers/applicant.repository.ts` → **exactly 1 match: line 296 (`suspended: users.suspended,` inside the pre-existing `listDirectory` projection)** — PRE-EXISTING, outside the new method's diff.
- `git diff -U0 backend/db/repo/teachers/applicant.repository.ts | grep "^+" | rg -c "…suspended…"` → **exit 1 (ZERO matches)** in the added lines: the new method's diff contains no `users` reference of any kind (also pinned executable: the test file's `source: the two-source split` pin asserts the method slice contains neither `suspended` nor `users`).
- Import proof: the diff is a single pure-append hunk — no import line added, so no `users` import was introduced by this task.

## 4. Test-case inventory (17)

Behavioral (all `runInRollback`, `tx` propagated to every repo/entity/Drizzle call; the method has no throwing paths, so — exactly like the transition suite — there are no `expectRepoError` probes and no `.rejects`):

1. Happy path — failed → lengthened: FULL 7-column row returned, status unchanged, new instant stored verbatim (strictly greater than the original), persisted-state oracle confirms.
2. `passed` → zero rows (null; status + cleared cooldown unchanged) — the terminal guard.
3. Missing applicant id → null (max-id-derived absent id).
4. `pending` admitted (pre-arming legal) — instant written verbatim, status untouched.
5. `in_evaluation` admitted — same.
6. Expired-cooldown base path — a past `cooldown_until` is overwritten verbatim with the caller's future instant (no repo-side arithmetic).
7. `updated_at` stamps forward (strictly later than the seeded instant).
8. Attempt audit trail + lifecycle status preserved (cooldown-only write).
9. Two-source split observable — after extension, the user account's governance flags read `suspended === false`, `suspendedAt === null`, `suspendedPeriodDays === null` (runtime lock that the cooldown write never spills onto the account row).
10. Hostile ids — `0`, `-1`, and an id beyond the table all return null.

Static pins (source-sliced, mirroring the transition suite's Tier-4 idiom): single guarded UPDATE with the three-member `inArray` pre-state and no `.select(`; exactly 3 `ApplicantStatus.` member references; REQUIRED tx (no `tx?`/`tx ?? db`/`db.update`); no prepared statements (file-level `.prepare(` pin); writes only `cooldownUntil: newExpiry` + `updatedAt: sql\`now()\`` with no `status:` write and no `users` reference; no `suspended` reference; enum members only (no status string literals), no `${` interpolation, no inline `--` SQL comments; no i18n/logger/console; no plan-artifact references (file-level pin).

## 5. Pipeline checklist evidence

- **2.QL** ✅ — both sub-loops exit 0 (§3).
- **2.TE** ✅ — 17/17 green; T1 both `row ?? null` branches + coverage table shows zero uncovered lines in the new method; T2 all four boundary cases; T4 hostile ids.
- **2.SEC** ✅ — raw SQL parameterized only (`eq`/`inArray` bind values; three enum members as values; `sql\`now()\`` constant); grep proof §3; no identifiers/PII anywhere in the write.
- **2.SR** ✅ — tx-last REQUIRED signature; bare-reads fallback N/A (write, `transitionToFailed` discipline mirrored); no `users` import added; no business logic/permission checks in the repo (service tier owns bounds/status disambiguation).
- **2.IV** ✅ — rule files read before/while editing: root `AGENTS.md`, `backend/AGENTS.md`, `backend/db/repo/AGENTS.md` (guarded-transition-writes rule — the WHERE-predicate-as-guard is that rule's direct implementation), `backend/db/test/AGENTS.md` (all 20 rules), `.agents/instructions/backend.instructions.md`, `.agents/instructions/tests.instructions.md`.

## 6. Comment discipline

Zero references to REQ IDs, task numbers, phases, or plan artifacts in any code comment/JSDoc (verified by grep over both files AND by the executable whole-file pin). Docblocks describe domain behavior only (guarded pre-state, verbatim instant, required tx, parameterization, zero-row miss semantics).

## 7. Notes for downstream tasks

- **Task 4 (`extendApplicantCooldown`):** call `extendCooldownOnce(applicantId, newExpiry, tx)` inside `withTransaction` AFTER the `findByUserId` status guard (the repo null collapses missing-applicant AND `passed` into one miss — the prior read distinguishes `APPLICANT_NOT_FOUND` from `APPLICANT_ALREADY_CERTIFIED`); the returned full row is not needed for the audit (the prior read supplies the `from` ISO; `newExpiry` is the `to` ISO); a null return mid-transaction after a passing read signals a concurrent status flip — treat as the certified/finalized conflict.
- **Task 5 (journey):** the repo-level `users` governance-flag lock (test 9) is the same assertion the journey must make at step 2/5; reuse the pattern.
- **Task 8 (final gate):** the file-level grep `rg "suspended" …applicant.repository.ts` will show the PRE-EXISTING `listDirectory` matches (line 296 region) — the distinguishing proof is the diff-scoped grep in §3 (zero matches in added lines), same method used here.
- Orchestrator: no `git commit` performed; `tasks.md` Task 2 checkboxes (2. + 2.QL/2.TE/2.SEC/2.SR/2.IV) flipped.
