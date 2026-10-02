# Task 14 Outcome — Final quality gate + deferred enforcement (Phase 5 — Final Gate)

> **Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
> **Task:** `14. Final quality gate + deferred enforcement` (Phase 5)
> **Date:** 2026-10-01 · **Agent:** general-purpose subagent · **Repo root:** `/home/z/my-project`
> **Result:** Gate PASSED. Deferred blocker grep = **0**; `bun tsgo` = **0 errors**; `bunx @biomejs/biome check .` = **exit 0**; full-repo `bun run lint` = **exit 0 (0 problems) after exactly ONE in-boundary lint fix**; per-file sub-loop (`--lifecycle duplicates`) = **exit 0** on the touched file; all 11 final-gate suites **green** with pass counts matching the Task-0/plan baselines exactly. Full-repo `bun quality-gate` FAILS only on the sandbox SIGKILL of the type-aware `tsgolint headless` helper (environment limitation, not findings — see §2.4 for the verbatim record + compensating gates). Scope audit: zero forbidden surfaces. No git commits.

---

## 1. Deferred enforcement (14.SR) — zero blocker glyphs

```
$ rg -c "❌|⚠️" ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/deferred-items.md
(no matches → count 0)
DEFERRED_BLOCKER_COUNT=0
```

D1..D6 remain accepted `⚪` deferrals. No blocker glyph exists in the ledger → completion is not blocked.

## 2. Per-stage quality evidence (14.QL / 14.TE)

### 2.1 Deferred grep
- Blocker glyphs (`❌|⚠️`) in `deferred-items.md`: **0** (§1).

### 2.2 Typecheck — `bun tsgo` (full repo)
- **0 errors, exit 0** (log: `/tmp/t14-tsgo.log`, captured by the prior verification run; unchanged since — the only subsequent code edit is the §4 one-line test assertion which introduces no new types).

### 2.3 Formatter/linter — Biome (full repo)
- `bunx @biomejs/biome check .` → **exit 0** (log: `/tmp/t14-biome.log`, prior verification run).

### 2.4 Full-repo lint — `bun run lint` (after fix) + `bun quality-gate` environment limitation

**`bun run lint` → exit 0, 0 problems** after the single §4 fix (log: `/tmp/t14-lint2.log`; pre-fix log `/tmp/t14-lint.log` held exactly 1 error, resolved below).

**Verbatim environment-limitation record (required):**

> Quality-gate `bun quality-gate` FAILS at oxlint stage ONLY because the type-aware `tsgolint headless` helper binary is SIGKILLed by the sandbox (4GB cgroup / 2 CPUs; run-locked-cmd 5-min cap) — environment limitation, NOT findings. Compensating gates: full-repo tsgo 0, biome 0, per-file sub-loops (which include oxlint + lint:type-aware) exit 0 on every touched file.

Compensating evidence for the oxlint + type-aware stages that the full-repo quality-gate run cannot reach in this sandbox:
- `bun run scripts/health/sub-loop.ts frontend/graphql/test/auth/auth.test.ts --lifecycle duplicates` → **exit 0** (`/tmp/t14-subloop.log`): tsgo ✅ (file-filtered) → oxlint ✅ → biome ✅ → lint:type-aware ✅ → check:duplicates ✅ (file outside jscpd scan scope — matches `.jscpd.json`).
- Prior tasks recorded per-file sub-loop exit 0 on every other file this plan touched (outcomes 1–13); none of those files changed during Task 14 except `auth.test.ts` (§4).

### 2.5 Baseline diff — zero NEW errors (14.TE)
- Baseline numbers: Task-0 artifacts (`/tmp/baseline-*`, `outcome/0-baseline-outcome.md`).
- Full-repo lint after fix: **0 problems → zero NEW errors vs the 0-problem baseline**. The single pre-fix error was a lint-config-vs-helper-visibility finding in a file this plan created (Task 6), not a repo-wide regression; it is fixed, not suppressed.
- tsgo 0 / biome 0: identical to baseline. No NEW findings of any class.

## 3. Suite-by-suite results (14.TE) — all green, counts match plan baselines

| # | Suite | Result | Expected | Match | Notes |
|---|---|---|---|---|---|
| a | `test/workflows/admin/audit-completeness.journey.test.ts` | **20 pass / 0 fail** (787 expect) | 20 | ✅ | `/tmp/t14-suite-a.log` |
| b | `backend/db/test/logic/audit/audit-census-drift.test.ts` | **19 pass / 0 fail** (139 expect) | 19 | ✅ | `/tmp/t14-suite-b.log` |
| c | `frontend/graphql/sharedDocuments/admin/admin-users.documents.test.ts` | **26 pass / 0 fail** (225 expect) | 26 | ✅ | `/tmp/t14-suite-c.log` |
| d | `frontend/graphql/test/admin/admin-users.integration.test.ts` | **49 passed / 0 failed** (319 expect) | 49 | ✅ | `/tmp/t14-suite-d.log` — see deviation note below |
| e | `backend/graphql/test/password-change-gate.test.ts` | **34 pass / 0 fail** (59 expect) | 34 | ✅ | `/tmp/t14-suite-e.log` |
| f | `frontend/graphql/test/auth/auth.test.ts` | **14 passed / 0 failed** (49 expect) | 14 | ✅ | `/tmp/t14-suite-f3.log` — see deviation note below |
| g | `backend/db/test/logic/users/user.repository.test.ts` | **14 pass / 0 fail** (39 expect) | 14 | ✅ | `/tmp/t14-suite-g.log` |
| h | `backend/db/test/logic/auth/auth.service.test.ts` | **14 pass / 0 fail** (54 expect) | 14 | ✅ | `/tmp/t14-suite-h.log` |
| i | `backend/services/admin/user-management.service.test.ts` | **78 pass / 0 fail** (324 expect) | 78 | ✅ | `/tmp/t14-suite-i.log` |
| j | `shared/locale/adminUsers-namespace.parity.test.ts` | **85 pass / 0 fail** (891 expect) | 85 | ✅ | `/tmp/t14-suite-j.log` |
| k | `shared/locale/errors-namespace.parity.test.ts` | **58 pass / 0 fail** (430 expect) | 58 | ✅ | `/tmp/t14-suite-k.log` |

Plus the prior-verification journey result carried forward unchanged: `test/workflows/admin/admin-password-reset.journey.test.ts` → **7 pass / 0 fail** (`/tmp/t14-journey.log`).

**Deviations (both environmental, zero code changes needed):**
1. **Suite d path:** the task brief cites `backend/graphql/test/admin/admin-users.integration.test.ts`; that path has no file ("Test filter … had no matches"). The suite lives at **`frontend/graphql/test/admin/admin-users.integration.test.ts`** (repo-wide glob confirms the only match) and is green there at 49/0. Test-path typo in the brief only — no fix, no code change.
2. **Suite f transient timeout:** first run failed with `registerUser — creates a student with role + preferredRecitation` timing out at 120 s; cause = a stray `next dev --turbopack -p 3066` server left by suite d's parallel run plus 2-CPU contention (suite f boots its own dev server on that port). Killed the stray process, re-ran suite f solo → **green 14/0 in 8.47 s**. Flaky-infra, not product code; nothing in-boundary changed for this.

## 4. The one lint fix (in-boundary, Task 6 file)

`bun run lint` (pre-fix log `/tmp/t14-lint.log`) reported exactly **1 error**:

```
frontend/graphql/test/auth/auth.test.ts  265:3  error  Add at least one assertion to this test case  sonarjs/assertions-in-tests
```

Root cause: the `test("changeMyPassword — without auth returns UNAUTHORIZED")` case asserts exclusively through the `expectMutationError(...)` helper, so `sonarjs/assertions-in-tests` (lexical analysis) sees zero assertions.

**Fix** (`frontend/graphql/test/auth/auth.test.ts`, ~line 265): added one direct, semantically correct assertion **before** the helper call — the probe asserts a REJECTED mutation, so:

```ts
// Direct assertion: the probe must reject the mutation (sonarjs needs a
// lexically visible assertion; expectMutationError rides on top of it).
expect(result.error).toBeDefined();
expectMutationError(result.error, "UNAUTHORIZED");
```

No other changes. Post-fix: full-repo `bun run lint` → **exit 0 / 0 problems** (`/tmp/t14-lint2.log`); sub-loop `--lifecycle duplicates` on the file → **exit 0**; suite f → 14/0 (§3).

## 5. Scope audit (14.SR) — delta bounded, zero forbidden surfaces

Working-tree delta checked via `git diff --name-only` / `git status --porcelain` (97-file plan delta per the prior scope-audit verification; no file outside that delta was touched during Task 14 except `tasks.md` checkbox flips + `worklog.md` append + this outcome file).

| Forbidden surface (REQ-011) | Verdict | Evidence |
|---|---|---|
| `navItems.ts` modified | ✅ **byte-unchanged** | absent from `git diff --name-only`; prior scope audit confirmed the file untouched |
| Profile `ChangePasswordCard` touched | ✅ **untouched** | absent from `git diff --name-only`; prior scope audit confirmed absence |
| Session-store / revocation introduced | ✅ **none** | delta grep `session|revocation` → no matches (stateless JWT posture preserved) |
| Mail / OTP delivery introduced | ✅ **none** | delta grep `mail|otp` → no matches |
| `app/api/**` beyond `apollo-server.ts` | ✅ **clean** | `git status --porcelain \| rg "app/api"` → empty; `app/api` = only `apollo-server.ts` (prior audit) |

Delta grep one-shot: `git diff --name-only | rg "navItems|ChangePasswordCard|session|revocation|mail|otp|app/api"` → **NO-FORBIDDEN-SURFACES**.

## 6. 14.SEC — `passwordHash` deep-walk assertion locations

Deep-field guarantee (`passwordHash` absent from EVERY response shape) is enforced at two layers; all citations verified by grep:

**Wire suites — recursive `deepFindKey` helper + assertions:**
- `frontend/graphql/test/auth/auth.test.ts` — helper `deepFindKey` at `:374-384` (recursive over arrays + objects); assertion `expect(deepFindKey(result.data, "passwordHash")).toBe(false)` at `:339` (auth flow's response payloads).
- `frontend/graphql/test/admin/admin-users.integration.test.ts` — helper at `:216-226`; assertions at `:531, :546, :587, :614, :642, :659, :730, :731` (detail mutations, delete flow, `details` echo — hash AND raw `details` absence both pinned).
- `frontend/graphql/test/admin-student-onboarding/admin-student-onboarding.test.ts` — helper at `:249-254`; assertions at `:432, :474` (pre-existing deep-walk pattern this plan followed).

**Journey suite — bespoke recursive deep-field walker:**
- `test/workflows/admin/admin-password-reset.journey.test.ts` — walker documented at `:151-166`: walks every object reachable from the value and fails if any key is `passwordHash` (`expect(key).not.toBe("passwordHash")` at `:166`); applied across detail/session/changeMyPassword/updateMyLocale results per outcome 11. Complementary raw-containment pins: `expect(rawDetails).not.toContain(targetRow?.passwordHash ?? "")` at `:351` (audit-details boundary) and bcrypt round-trips at `:322, :370, :395-396, :463-464` (hash correctness on the wire-visible behavior: new credential verifies, old/temp fails).

## 7. Gate verdict

| Stage | Status |
|---|---|
| Deferred blocker grep | ✅ 0 |
| tsgo full-repo | ✅ 0 errors |
| Biome full-repo | ✅ exit 0 |
| `bun run lint` full-repo | ✅ exit 0 / 0 problems (after 1 in-boundary fix) |
| Sub-loop duplicates (touched file) | ✅ exit 0 |
| `bun quality-gate` full-repo | ⚠️ environment-limited at oxlint stage (tsgolint SIGKILL — §2.4 verbatim); compensated |
| 11 final-gate suites | ✅ 397 tests green, counts == baselines |
| Scope audit | ✅ zero forbidden surfaces |
| Baseline diff | ✅ zero NEW |

**Task 14 = COMPLETE.** Task 15 (knowledge propagation) remains open for the next run.
