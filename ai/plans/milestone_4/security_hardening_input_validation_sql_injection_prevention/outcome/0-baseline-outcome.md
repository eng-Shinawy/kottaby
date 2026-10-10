# Task 0 Outcome: Pre-Implementation Baseline

**Plan:** `ai/plans/milestone_4/security_hardening_input_validation_sql_injection_prevention`
**Date captured:** 2026-10-09, ~01:56–02:05 EEST (+0300)
**Executor:** Task 0 baseline subagent (no production source files intentionally modified)

---

## Baseline Counts (exact)

| Check | Result | Raw artifact |
|---|---|---|
| `bun tsgo` | **2 errors** (exit 1) | `/tmp/baseline-tsgo-full.txt` (count in `/tmp/baseline-tsgo.txt`) |
| `bun biome:check` | **0 warnings**, 1 info (schema-version mismatch notice, `biome.json` pins 2.5.13 vs CLI 2.5.15), exit 0 | `/tmp/baseline-biome-full.txt` (count in `/tmp/baseline-biome.txt`) |
| `bun run scripts/lint-service.ts --json --id baseline` | **success: true, exitCode: 0, zero errors** (full-repo scope, 9.0s) | `/tmp/baseline-lint.json` |
| `bun run test` (full suite) | **CAPTURED — 5957 pass / 2646 fail / 16 errors / 15 skip** across 8618 tests, 469 files (469.8s, exited 1) | `/tmp/baseline-test-full.txt` (last 100 lines only) |
| `git stash list` | 1 pre-existing stash: `stash@{0}: WIP on main: ede7a747 Surah/Juz Enum Homework Tracking…` | `/tmp/baseline-stash.txt` |

### Pre-existing tsgo errors (MUST NOT be reported as new by the review wave)

1. `frontend/views/admin/directory-shared/DirectoryCopyLinkButton.tsx(20,10): error TS6133: 'focusVisibleRingSx' is declared but its value is never read.` — file was already dirty/concurrently-edited at capture time (see anomaly below).
2. `frontend/views/admin/users/dialogs/EditUserDialog.tsx(79,5): error TS2322: Type '"" | "Female" | "Male" | "Other"' is not assignable to type '"" | "Female" | "Male"` — committed state, NOT in the dirty set.

### Full-suite test baseline interpretation

**A full-suite baseline WAS captured** (no timeout): 2646 failures / 16 errors is the pre-existing floor when running raw `bun run test` in this environment (aggregate of db/integration/service/graphql layers run without the layer-specific parallel runners and their env setup — e.g., the tail shows a whole Paymob reconciliation sweep suite failing fast). Post-implementation review must treat this aggregate as noisy: per-layer verification via `bun run test/scripts/run-test.ts <path>` and the layer-specific `test:db` / `test:services` / `test:integration` runners is the authoritative signal, not the raw aggregate delta.

---

## Pre-Existing Modified Files (`git diff --name-only`, snapshot 2026-10-09 02:00:26 +0300)

> **ANOMALY — READ FIRST:** the working tree was being **actively modified by a concurrent plan execution** during this baseline (a second orchestrator running `ai/plans/milestone_4/workflow_tests_student_journey/` — its own `outcome/0-baseline-outcome.md` appeared mid-capture; file mtimes 01:52→01:58+ sequential). The dirty set therefore **grew between snapshots** (18 files at 01:57 → 23 at 02:00). The list below is the 02:00:26 snapshot; the review wave must treat **any file dirty as of plan start** as pre-existing, not new work from this plan. Post-implementation diff review should diff against this list, not against "tree was clean".

```
ai/plans/milestone_4/workflow_tests_student_journey/tasks.md
backend/db/repo/classes/session.repository.helpers.ts
backend/db/repo/classes/session.repository.ts
backend/db/repo/classes/session.repository.test.ts
backend/graphql/gqlContextFactory.ts
backend/lib/api/cron-auth.ts
backend/lib/api/test/cron-auth.test.ts        (untracked, ?? — created before/at plan start)
backend/lib/auth/cookies.test.ts
backend/lib/auth/cookies.ts
backend/lib/gateway/cron-endpoint.ts
backend/lib/ratelimit.test.ts
backend/lib/ratelimit.ts
backend/services/admin/admin-academic-tracking.service.ts
backend/ws/notification-ws-server-handshake.ts
frontend/components/ui/CatalogEmptyState.tsx
frontend/components/ui/CatalogHeader.tsx
frontend/views/admin/directory-shared/DirectoryCopyLinkButton.tsx
frontend/views/admin/directory-shared/DirectoryExportCsvButton.tsx
frontend/views/admin/directory-shared/DirectoryToolbarRefreshButton.tsx
frontend/views/admin/directory-shared/DirectoryToolbarSearchField.tsx
frontend/views/admin/teachers/AdminApplicantIdentityCell.tsx
frontend/views/admin/users/detail/ProfileInfoCard.tsx
frontend/views/admin/users/directory/DirectoryUserIdentityCell.tsx
frontend/views/parent/monitoring/SearchFilterBar.tsx
```

Full porcelain status in `/tmp/baseline-status.txt`; earlier 18-file snapshot also preserved (file was overwritten at 02:00 — the 18-file set at 01:57 was identical minus the session.repository trio, admin-academic-tracking.service.ts, and the workflow_tests tasks.md/outcome rows, and it also listed the same `cron-auth.test.ts` as untracked).

⚠️ **Secondary anomaly:** this project's `biome:check` npm script is `bunx @biomejs/biome check --write --unsafe .` — it **auto-writes fixes**. Running it (as this task's instructions required) reported "Fixed 2 files" at 01:56:45. Because of the concurrent editing, the 2 auto-fixed files cannot be identified retroactively, and reverting anything is unsafe (it could destroy concurrent-agent work). The tree state at 02:00 includes those fixes. Reviewers: minor biome-format diffs in the files above may originate from this baseline command, not from implementation tasks.

---

## Deferred-Items Ledger Confirmation

- `grep -cE '^\s*\|.*(❌|⚠️)' deferred-items.md` → **0** (expected 0) ✅
- Rows **D1–D8 all present**, every row is `✅ resolved-pointer` status (D7 resolved-by-prior-work no-op pointer, D8 `resolved-by-verification (pre-seeded)` pending task 1.5's TE closure). No ❌/⚠️ rows. Ledger confirmed clean.

---

## Evidence-Pack Summary (from `specs.md` header, baseline audit facts)

The ticket's six Gherkin outcomes were grep-audited at plan time and four are already substantially shipped: security headers exist in `next.config.ts:48-85` but CSP carries `unsafe-inline`/`unsafe-eval` with missing `object-src`/`base-uri`/`form-action`/`worker-src`, COOP/CORP, and `poweredByHeader` suppression; SQL parameterization is universal (Drizzle builders, `sql\`\`` binds, `$N`-placeholder `queryDb`) with zero production `sql.raw(` hits (only dev migration tooling `runDrizzleMigrations.ts:116`, `ensureIdempotentMigrations.ts:310`) and `escapeLikeWildcards` covering all 14 `ilike()` call-site lines — but all audit-verified only, so this plan converts them to CI-enforced regression locks; XSS is prevented architecturally (React text-node escaping, zero dangerous sinks) except three components cite a nonexistent static scanner and CSV formula neutralization exists in only 1 of 4 cell builders (`PrintExportDialog.tsx:36-42`); CSRF is partially covered (SameSite=Strict cookies, POST+JSON transport gates, WS/set-locale origin checks) but the cookie-authenticated GraphQL POST path has NO Origin/`Sec-Fetch-Site` verification — the genuine REQ-040 build item; auth rate limiting is entirely missing beyond the shared 100 req/min per-IP window (headline REQ-050 build item, plus the rate-limiter-less `reconcile-paymob-payments` cron route REQ-052); and input validation is service-side by design with three transport gaps (uncapped `/api/set-locale` body, unbounded GraphQL batch count with `allowBatchedHttpRequests: true`, untrimmed/unbounded login email). Two authorization footguns are in scope (no-op `permission: () => true` scope at `builder.ts:142`; missing `$all { authenticated: true }` conjunction on 3 plan-catalog mutation fields), plus documentation-truth defects (4 false "stub limiter" claims, 2 nonexistent `proxy.ts` references).

---

## Carry-Forward Knowledge for Implementation Subtasks

1. **Bun binary**: plain `bun` is on PATH in this environment, but use `~/.bun/bin/bun` defensively — both worked here.
2. **Lint service**: `~/.bun/bin/bun run scripts/lint-service.ts --json --id <id>` returns `{success, output, exitCode, metrics}`; baseline ran clean (exit 0, 9s full-repo). File-scoped form: `-f <file> --id <caller-id>`.
3. **Pre-existing errors the review wave must NOT report as new**: the 2 tsgo errors listed above; the biome schema-version info notice (`biome.json` 2.5.13 vs CLI 2.5.15); the raw-`bun run test` aggregate (2646 fail / 16 errors pre-existing floor); the 1 git stash (`stash@{0}` WIP on main ede7a747); the ~23-file dirty set above.
4. **Concurrent execution in flight**: a parallel plan (`workflow_tests_student_journey`) shares this working tree. Expect its files to keep changing; do not "clean up" or revert files outside this plan's task file lists. When verifying per-file, scope lint/tsgo reads to your own files where possible.
5. **`biome:check` auto-writes** (`--write --unsafe`) — it is a mutating command, not a read-only check. Subagents capturing "biome baseline" again should know this.
6. **Test verification**: use `bun run test/scripts/run-test.ts <path>` (mandatory for DB tests) and the layer-specific parallel runners, not raw `bun run test`; the raw aggregate has a 2646-failure pre-existing floor in this environment.
7. **plan-review-R1 verdict** (the only pre-existing outcome file): plan passed all AGENTS.md rules post-fix — 14 findings fixed in-session (ilike census corrected to 8 files/14 lines/19 occurrences at `plan.md §5.15`; CSV task 3.4 re-scoped to EXTRACT the existing `neutralizeCsvFormulas` into `frontend/utils/csv-formula.ts` instead of duplicating; auth-limiter tests re-pinned to new in-process suite `backend/graphql/test/auth-rate-limit.test.ts`; `ctx.t("authTranslations")` — NOT `ctx.t("auth")`; explicit client `batchMax: 10`; TEST bypass mirrored verbatim from `app/api/graphql/rate-limit.ts:34-48`; `cronSweepRateLimiter` needs one `export` keyword at `backend/lib/gateway/cron-endpoint.ts:79-83`). Future subagents must implement per the POST-FIX plan text.

---

## Raw Artifacts (all under /tmp/)

`/tmp/baseline-tsgo.txt` (count=2), `/tmp/baseline-tsgo-full.txt`, `/tmp/baseline-biome.txt` (count=0), `/tmp/baseline-biome-full.txt`, `/tmp/baseline-lint.json`, `/tmp/baseline-test-full.txt`, `/tmp/baseline-stash.txt`, `/tmp/baseline-files.txt`, `/tmp/baseline-status.txt`
