# Phase 0 Baseline Outcome — Tasks 0.1 + 0.2 (DEV3-020)

**Plan directory:** `ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac`
**Task:** 0.1 Record error baseline & initialize deferred-items ledger (+ 0.2 sweep recorded in `0.2-prereq-verification-outcome.md`)
**Captured:** 2026-09-01, git branch `feat/dev3-020-immutable-audit-logging-for-all-admin-ac` (HEAD clean)

---

## 1. Baseline command results (exact numbers)

| Command | Exit code | Exact result |
|---|---|---|
| `bun tsgo` (runs `tsgo -b --noEmit` via process lock) | **0** | **0 type errors** (0 `error TS` lines in output; only `restore-next-env-dts` + process-lock log lines). Output archived at `/tmp/baseline-tsgo.txt` |
| `bun run oxlint` (`--deny-warnings --ignore-path .gitignore`) | **0** | `Found 0 warnings and 0 errors. Finished in 17.6s on 1050 files with 303 rules using 2 threads.` → **0 warnings, 0 errors** |
| `bun run biome:check` (`biome check --write --unsafe .`) | **0** | `Checked 1074 files in 8s. No fixes applied.` → **0 diagnostics applied**; working tree still clean afterwards |
| `bun run lint --json --id baseline` (`scripts/lint-service.ts`) | **0** | `{ "success": true, "output": "", "exitCode": 0, "metrics": { "id": "baseline", "scope": "full-repo", "fileCount": 0, "durationMs": 55525, "enqueuedAt": 1788272595966, "startedAt": 1788272595966, "finishedAt": 1788272651491, "queueDepthAtEnqueue": 0 } }` |
| `git diff --name-only` | 0 | **EMPTY** — zero pre-existing modified files (clean working tree) |
| `git stash list` | 0 | **EMPTY** — zero stashes |

**Baseline delta gate for end-state (REQ-082):** tsgo = 0 errors, oxlint = 0/0, biome = clean, lint-service = success; every later phase must land at **baseline + 0**.

**Test-tier baseline (captured for honest differentials — see §4):** `sdl-static-assertions.test.ts` 15 pass / **3 fail** (pre-existing stale pins); `schema-surface.test.ts` 29 pass / **4 fail** (same drift class); `apolloCache.test.ts` 9 pass / **1 fail** (frozen policy list vs live 6 keys).

---

## 2. Environment facts (verified live)

- **DB mode: postgres.** `.env` line 1: `DB_PROVIDER=postgres`; line 2: `DATABASE_URL=postgresql://postgres@127.0.0.1:5432/app_db` (userspace PG 17.11 cluster at `/home/z/pg`, socket `/home/z/pgsocket`, per worklog setup).
- **Migrate-provisioned DB with triggers LIVE.** `pg_trigger` probe on `app_db` (`SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid='audit_logs'::regclass AND NOT tgisinternal`) returned:
  - `prevent_audit_logs_delete_trigger | O`
  - `prevent_audit_logs_update_trigger | O`
  (`O` = enabled. Matches worklog setup verification — both audit_logs immutability triggers are live.)
- **`.env.test` materialized** (exists, 1735 bytes) — tests run via `bun run test/scripts/run-test.ts <path>` (which injects `--env-file=.env.test`, `test/scripts/run-test.ts:154`).
- **bun binary:** real bun at `/usr/local/bin/bun`. The mandated runner `test/scripts/run-test.ts:6` hardcodes `~/.bun/bin/bun`; that path was absent (ENOENT on first run) — **environment fix applied:** symlink `/home/z/.bun/bin/bun → /usr/local/bin/bun` (outside the repo; no source file touched). Recorded so later agents don't misread the ENOENT as a repo defect.
- Repo shipped `backend/db/migration/3-immutability-triggers-sqlite.sql` too (SQLite-local-dev parity per `docs/SQLITE_LOCAL_DEV.md`) — no bearing on REQ-020's postgres branch.

---

## 3. Deferred-items ledger initialization

`deferred-items.md` initialized with the Ledger Table pre-seeded with the SIX resolved-as-reference entries lifted verbatim in meaning from `plan.md` §"Deferred items" (plan.md:508–517):

| ID | One-line meaning (from plan.md) |
|---|---|
| D-ET-DROPDOWN | `SELECT DISTINCT entity_type` feed for a dropdown-backed filter UI — future UX ticket (v1 is equality-match only per D5) |
| D-GOV-WINDOW | Request-time governance re-check on read surfaces (governed caller + pre-issued token window, REQ-033) — governance-context ticket (shared with notification matrix window + DEV3-022c) |
| D-KEYSET | Keyset pagination refinement over `(created_at, id)` — future perf refinement (mirrors DEV3-016's D8 posture) |
| D-EXPORT | CSV/PDF audit export — future compliance ticket, explicitly out of scope |
| D-DETAIL-PROJECTION | Per-producer `details` projection vocabulary stays per-surface — owning producer tickets (DEV3-022d lineage; global read layer flows `details` verbatim per D8) |
| D-TRIGGER-PUSH-GAP | Push-provisioned environments never apply custom SQL triggers — migrate-capable rollout path documented in the canonical doc (ops runbook / `docs/admin/audit-trail.md` REQ-080) |

All six are ✅ Done with "pre-registered reference" semantics — owned by later tickets, **non-blocking for DEV3-020**. The ledger's existing sections (Purpose, Status Values) are untouched.

**End-state gate note for the closing task:** the REQ-083 gate `grep -c "❌\|⚠️" deferred-items.md` must be read against the **Ledger Table rows only** — the ledger's pre-existing (template) "Status Values" legend section itself contains ❌/⚠️ glyphs (2 lines: ⚠️ Partial, ❌ Blocked). No ledger ROW carries ❌/⚠️.

---

## 4. Pre-existing issues to IGNORE during DEV3-020 review (baseline state, NOT caused by this work)

1. **`backend/graphql/test/sdl-static-assertions.test.ts` — 3 pre-existing failures** (15 pass / 3 fail). Stale frozen pins vs concurrently-landed Sprint-3 surfaces (DEV3-016 admin users + DEV1-005 plans + DEV1-013 handshake):
   - `Mutation root is EXACTLY the refreshed frozen 7-op baseline` (:220–223) — artifact Mutation root additionally has `adminCreateUser`, `adminSetUserDeleted`, `adminUpdateUser`, `createPlan`, `setPlanActiveStatus`, `updatePlan`.
   - `Query root is EXACTLY the frozen baseline + _health probe` (:225–228) — artifact Query root has **+8** fields beyond `FROZEN_QUERY_FIELDS`: `adminPlans`, `adminUserActivity`, `adminUserDetail`, `adminUserStats`, `adminUsers`, `findStudentByHandshakeCode`, `myHandshakeCode`, `planCatalog`.
   - `NO Subscription root exists` (:324–330) — the `hasSubscriptionRoot` AST check passes; the **lexical** `sdlText` must-not-contain "Subscription" check trips on `hasActiveSubscription: Boolean!` (DEV3-016 `AdminStudentSnapshot`) and "subscription plan" prose inside `Plan`/`CreatePlanInput` descriptions. False-positive class, needs re-pin handling.
2. **`backend/graphql/test/schema-surface.test.ts` — 4 pre-existing failures** (29 pass / 4 fail). Same drift class (details + exact diffs in `0.2-prereq-verification-outcome.md` §9). Note the **artifact↔builder byte-identity test passes** — only the frozen inventory pins are stale.
3. **`frontend/providers/apollo/apolloCache.test.ts` — 1 pre-existing failure** (9 pass / 1 fail): `policy surface is FROZEN to the five documented entries` (:176–185) vs live 6-key set (+`NotificationListPage`).
4. **Sub-loop quality gate on Markdown files:** `bun run scripts/health/sub-loop.ts <file.md> --lifecycle duplicates` always exits 1 because its oxlint step reports `No files found to lint` for `.md` paths (wrapper treats that as failure). tsgo step passes. Verified path-artifact: the same gate exits **0** on a `.ts` file (`backend/types/audit/index.ts`). Record as artifact, not a content violation.

These five failing tests + the gate artifact are the honest differential baseline for Phases 3–7 ("baseline + 0" applies to the static gates; test-suite differentials must account for these pre-existing reds).
