# Task 2.M Outcome — Mid-Point Review Gate (DEV3-020)

**Plan directory:** `ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac`
**Task:** 2.M Mid-point review gate
**Branch:** `feat/dev3-020-immutable-audit-logging-for-all-admin-ac` (found flipped to `main` FIVE times during this task — the recurring sandbox artifact documented since Phase 1; restored and re-verified after every gate run; both refs identical so the working tree was never affected)
**Inputs read in full before acting:** worklog.md (all entries), ALL nine outcome files under `outcome/`, tasks.md Phase 2.M block, deferred-items.md, and every file in the semantic-review scope (types/audit pair, services/admin trio, db/repo/audit trio, and the four test files).

---

## 1. Consolidation checklist (the four ✔ items)

| # | Gate item | Verdict | Evidence |
|---|---|---|---|
| 1 | Journey test authored (red) | **✔ COMPLETE** (recorded deviation: green-on-arrival) | `test/workflows/admin/audit-trail.journey.test.ts` (647 lines) authored and audited step-by-step in Task 2.2; the plan's TEST-FIRST compile-red was replaced by the mandated mutation-sensitivity proof (RED 5 pass / 2 fail on a `totalCount` mutant → GREEN after revert), per `outcome/2.2-outcome.md` §2. |
| 2 | Repo + service implemented with green unit tiers | **✔ COMPLETE** | `AuditTrailRepository` (Task 2.3) + `AuditTrailService` (Task 2.4); repo tier 15 pass / 0 fail, service tier 35 pass / 0 fail — re-verified green in this gate (§3). |
| 3 | Gate extraction byte-equivalence | **✔ COMPLETE** | D2 = IMPORT branch: `admin-gate.helpers.ts` byte-unchanged (`git diff` on it empty — verified again this gate); `assertActorAdmin` + `toAuditActionType` single definitions repo-wide (rg sweep: exactly 2 definition hits, both `admin-gate.helpers.ts:25` and `:59`); DEV3-016 regression suites byte-green (61 + 8 = 69, inside the §3 directory run). |
| 4 | Immutability triple recorded | **✔ COMPLETE** | Task 2.5 triple (static scan 278-file corpus zero violations + DB trigger tier EXECUTED on real postgres — both mutation attempts THREW + migration-DDL pin) per `outcome/2.5-outcome.md` §1; re-verified green in this gate (§3). |

## 2. Counter deltas vs Phase-0 baseline (exact numbers)

| Gate command | Phase-0 baseline | 2.M re-run | Delta |
|---|---|---|---|
| `bun tsgo` | 0 type errors (exit 0) | **exit 0, 0 `error TS` lines** | **0** |
| `bun run oxlint` | 0 warnings / 0 errors (1050 files) | **`Found 0 warnings and 0 errors.` (1058 files, 303 rules)** | **0** |
| `bun run biome:check` | clean, `No fixes applied` (1074 files) | **`Checked 1082 files in 7s. No fixes applied.`** | **0 diagnostics** (file count grows only by the new Phase-1/2 files) |
| `git diff --name-only backend/db/schema/` | EMPTY | **EMPTY (0 lines)** | **0 — REQ-042 zero-drift holds** |

## 3. Targeted suites (sanctioned runner `bun run test/scripts/run-test.ts`)

| Suite | Result |
|---|---|
| `backend/services/admin` (whole directory — includes the DEV3-016 regression lock) | **104 pass / 0 fail, 472 expect() calls** across 3 files (user-management.service 61 + user-management.chaos 8 + audit-trail.service 35) |
| `backend/db/test/logic/audit` (repo + immutability) | **32 pass / 0 fail, 366 expect() calls** across 2 files (repository 15 + immutability 17) |
| `test/workflows/admin/audit-trail.journey.test.ts` | **7 pass / 0 fail, 126 expect() calls** — reproduces the recorded Phase-5 green signature exactly |
| (single-file confirmation) `backend/services/admin/audit-trail.service.test.ts` | **35 pass / 0 fail, 190 expect() calls** |

Sub-loop `--lifecycle duplicates` re-run on BOTH files touched by this gate: `audit-trail.service.test.ts` exit 0 (all five steps ✅) and `audit-immutability.test.ts` exit 0 (jscpd step skipped-by-scope, per the known path artifact).

## 4. Ledger check (REQ-083 reading discipline)

Raw `grep -c "❌\|⚠️" deferred-items.md` = **2** — both hits are the ledger's own pre-existing "Status Values" legend lines (`⚠️ **Partial**` :31, `❌ **Blocked**` :32), exactly as documented in `phase0-baseline-outcome.md` §3.

Row-level status counts (Ledger Table rows with a `|` ID entry):

| Status | Rows |
|---|---|
| ✅ Done | **6** (D-ET-DROPDOWN, D-GOV-WINDOW, D-KEYSET, D-EXPORT, D-DETAIL-PROJECTION, D-TRIGGER-PUSH-GAP — all pre-registered reference items) |
| ⚠️ Partial | **0** |
| ❌ Blocked | **0** |
| 🔄 In Progress | **0** |
| 📅 Forward | **0** |

**Verdict: zero unplanned ❌/⚠️ ledger rows — no resolution or deferral needed to pass this gate.**

## 5. Semantic review — per-file verdicts

| File | Race conditions / atomicity | Module-level mutable state | Dead branches / cross-layer imports | Manual ReturnType | Enum value-import at runtime | Plan-artifact tokens | Other |
|---|---|---|---|---|---|---|---|
| `backend/types/audit/audit-trail.types.ts` | N/A (interfaces) | none | none — type-only enum import matches the types-layer convention (no runtime use ⇒ value import would be dead weight) | none | N/A (type-only is CORRECT here) | **0** (grep: REQ-/Task 2/DEV3-020/D-n/plan.md/tasks.md/specs.md) | canonical shapes verbatim; no table-type re-declaration |
| `backend/types/audit/index.ts` | N/A | none | none | none | N/A | 0 | +1 export only |
| `backend/db/repo/audit/audit-trail.repository.ts` | read-only; `(tx ?? db)` on BOTH methods, `tx` optional-LAST — no read-then-write anywhere | none | none; zero LIKE/ILIKE/escapeLikeWildcards, zero prepared statements/`--`, zero write calls | none | type-only enum import (no runtime use in repo — coercion is service-owned) | **0** | ONE shared `buildWhere` for list+count (cannot drift); half-open window; `desc(createdAt), desc(id)`; join-free count is join-equivalent (NOT NULL RESTRICT FK) |
| `backend/db/repo/audit/index.ts` + `backend/db/repo/index.ts` | N/A | none | none | none | N/A | 0 | single-line barrel additions, style-matched |
| `backend/services/admin/audit-trail.service.ts` | **PASS — the repeatable-read snapshot wraps countEntries+listEntries in ONE tx**: `readInSnapshot` opens `db.transaction(fn, { isolationLevel: "repeatable read" })` when no caller tx, or joins `outerTx.transaction(fn)` as a nested block; both reads receive the SAME tx + the SAME normalized filter object (asserted by the same-tx identity oracles in the service suite) | **none** (only the `MAX_ENTITY_TYPE_LENGTH` const; no mutable module state) | none; no dead branches (each validator: absent→drop / malformed→throw / valid→set — all paths test-covered); imports confined to backend + shared/locale layers | none | **YES — value import** (`Object.values(AuditActionType)` fail-closed membership re-assertion :131) | **0** | happy path logs NOTHING; denials owned by the shared gate; honest envelope; `page ?? 1` + `resolvePageBounds` pre-DB; `toAuditActionType` at map time, null → masked plain Error (never a raw string leak) |
| `backend/services/admin/admin-gate.helpers.ts` (pre-existing, scope = verify) | zero writes; gate's only await is `UserRepository.findById` (a read); denials pre-DB | none (const sentinel only) | none | none | value import (switch returns enum members) | 0 DEV3-020 tokens (the DEV3-016 header mention is pre-existing cross-ticket prose; file untouched) | **byte-unchanged** — `git diff` empty; single definitions confirmed |
| `backend/db/test/logic/audit/audit-trail.repository.test.ts` | every test in `runInRollback`; `tx` propagated to EVERY call | none | none — db/test layer only | none | **value-imported** (fixture data + filter values at runtime) | **0** | `expectRepoError` try/catch (no `rejects.toThrow`); recursive page walker; isolation anchors immune to pre-existing data |
| `backend/db/test/logic/audit/audit-immutability.test.ts` (touched by this gate — §7 fix 2) | every DB statement in `runInRollback` | none | none — `isPgliteProvider()` environment branch is honest (tier RAN on real postgres, not skipped) | none | value-imported (fixture + non-vacuity fixtures) | **0** | teardown allowlist now bijective over THREE exact paths (incl. the journey file, §7 fix 2); live-match assertion prevents rot |
| `backend/services/admin/audit-trail.service.test.ts` (touched by this gate — §7 fix 1) | `runInRollback` + tx threading | `trackedSpies` registry — the DOCUMENTED test-side spy-lifecycle pattern (restored per test by the file-level `afterEach`; this is the 2.4.TE convention, not production state) | none — backend-only + `bun:test` imports | none (`ReturnType<typeof spyOn>` is a type-level alias for the spy shape, the established sibling convention — no canonical type bypassed) | value-imported | **0** | §7 fix 1: inherited-mock immunity at the one leaky seam |
| `test/workflows/admin/audit-trail.journey.test.ts` | committed one-tx fixtures; teardown = sanctioned path only (`withAuditDeleteTriggersSuspended`) | none beyond the TrackedFixtures registry (established journey convention) | layer rules honored: workflows → backend services/repos/schema + shared/locale + test helpers; deep import of db-cleanup documented in-file | none | value-imported (7-value filter sweep) | **0** | oracles-not-spies for the zero-notification proof; byte-unchanged by this gate |

Cross-file scans (all clean): no `console.*` in any new file; no LIKE/ILIKE in any new backend file; zero frontend/shared-frontend imports in backend sources; repo-wide definition sweep shows exactly 2 definitions of the gate pair, both in `admin-gate.helpers.ts`.

## 6. Scope boundary (`git status --porcelain` — every entry accounted for)

| Entry | Owning phase/task |
|---|---|
| `M ai/plans/.../deferred-items.md` | Phase 0 (ledger seeding) |
| `M ai/plans/.../tasks.md` | Phase 1–2 checkbox flips (+ this gate's 2.M flip) |
| `M backend/types/audit/index.ts` | 1.1 (+1 export) |
| `M backend/db/repo/index.ts` | 2.3 (+1 export) |
| `M backend/services/admin/index.ts` | 2.1 (+1 admin-gate.helpers export) + 2.4 (+1 audit-trail.service export) |
| `?? outcome/` | Phase 0–2 outcome files |
| `?? backend/types/audit/audit-trail.types.ts` | 1.1 |
| `?? backend/db/repo/audit/` | 2.3 |
| `?? backend/db/test/logic/audit/` | 2.3.TE + 2.5 |
| `?? backend/services/admin/audit-trail.service.ts` + `.test.ts` | 2.4 + 2.4.TE |
| `?? test/workflows/admin/audit-trail.journey.test.ts` | 2.2 |

**No unexplained files. `backend/db/schema/` untouched; `admin-gate.helpers.ts` untouched.**

## 7. Fixes applied by this gate (both within Phase-2 scope)

### Fix 1 — `backend/services/admin/audit-trail.service.test.ts`: directory-run failure ("Expected 1, Received 29")

- **Symptom:** `bun run test/scripts/run-test.ts backend/services/admin` ran 103/1 — the FIRST spy-using test (`anonymous caller → UnauthorizedError … one bounded log`) failed `expect(logSpy).toHaveBeenCalledTimes(1)` with **29 calls**. Single-file runs were green (35/0), so the failure was cross-FILE.
- **Root cause:** bun reuses ONE mock per object+method pair until restored. The sibling DEV3-016 suites create `spyOn(logger, "logDomainError")` and never restore it (`user-management.service.test.ts:112`, `user-management.chaos.test.ts:104` — no mockRestore/afterEach in either). Running the directory in one process, the audit-trail suite runs LAST; its first `spyOn` inherited the sibling mock with 28 accumulated calls. The file-level `afterEach` (added in 2.4.TE) could only restore OUR spies — the first test's assertion still saw the inherited history. After the first test, the afterEach restored the inherited mock, so every later test was clean (matches the observed 1-fail signature).
- **Fix (final, after three rejected variants):** `silenceDomainLog()` now calls `.mockClear()` on the spy before tracking — the mock returned by `spyOn` may be the inherited instance, and clearing it makes this file's call-count assertions absolute from a zero baseline. One line + doc comment; all assertions byte-identical. Rejected variants (for the record): (a) duck-typed restore helper with a cast → oxlint `typescript(no-unsafe-type-assertion)`; (b) `isMockFunction` guard → `TS2305: not exported by "bun:test"` types; (c) `in`-narrowed unbound `restore()` call → runtime `ERR_INVALID_THIS` (`Expected this to be instanceof Mock` — unbound-this on bun's prototype-backed mock).
- **Result:** directory run **104/0** AND single-file run **35/0** — both green with one implementation.

### Fix 2 — `backend/db/test/logic/audit/audit-immutability.test.ts`: teardown-allowlist bijection

- **Symptom:** the audit directory run failed the bijection test with `+ "test/workflows/admin/audit-trail.journey.test.ts"` (received 3 files, allowlist had 2).
- **Root cause:** a cross-task landing gap the mid-point gate exists to catch. Task 2.5 ran BEFORE Task 2.2's journey file was finalized (worklog order 2-c → 2-e). The journey file's `afterAll` teardown deletes audit rows (by-actor Drizzle delete + by-entity raw parameterized sweep) under `withAuditDeleteTriggersSuspended` — the sanctioned committed-teardown pattern — tripping the static scanner as an un-allowlisted mutator.
- **Fix:** added `"test/workflows/admin/audit-trail.journey.test.ts"` to `TEARDOWN_ALLOWLIST_PATHS` (exact path, per the maintenance contract documented in `outcome/2.5-outcome.md` §5) and updated the constant's JSDoc ("Both helpers" → "All three"). The bijection test itself verified the entry is LIVE (the file really mutates) — the allowlist cannot rot.
- **Result:** audit directory run **32/0** (and the trigger tier still RAN — not skipped — on real postgres).

## 8. CROSS-FILE DEPENDENCY (reported, NOT fixed — outside Phase-2 file scope)

- `backend/services/admin/user-management.service.test.ts:112` and `backend/services/admin/user-management.chaos.test.ts:104` each create `spyOn(logger, "logDomainError")` with **no restoration path** (no `mockRestore`, no `afterEach`). Benign for their own suites (each installs its own spy at test start), but they leave the mock installed process-wide, so any LATER suite in the same directory run that spies the same method and asserts ABSOLUTE call counts inherits the accumulation. The audit-trail suite is now immune (§7 fix 1). Recommendation for the orchestrator: consider a small DEV3-016 hygiene follow-up adding the trackedSpies/afterEach pattern to those two files; deliberately NOT changed here to preserve the zero-diff discipline on non-Phase-2 files.

## 9. Verdict

**GO for Phase 3** (GraphQL resolvers & API handlers). All static counters at baseline + 0; all targeted suites green including the DEV3-016 regression lock; ledger clean; schema zero-drift holds; semantic review clean on every file; both gate-caught defects fixed and re-verified. The recurring stray-`main` checkout artifact recurred five times in this task and was restored each time — later agents should keep re-checking `git branch --show-current`.
