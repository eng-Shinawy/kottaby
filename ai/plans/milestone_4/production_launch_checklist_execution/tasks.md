# Implementation Tasks: Production Launch Checklist Execution

> **Plan directory (verbatim):** `ai/plans/milestone_4/production_launch_checklist_execution`
> **Specs of record:** `ai/plans/milestone_4/production_launch_checklist_execution/specs.md` (REQ-000..REQ-013 · slices S1–S11 · deferred pointers D1–D17 — specs §2.2 D1–D11 canonical + plan-introduced D12–D17 · journeys J1–J3) · **Design of record:** `ai/plans/milestone_4/production_launch_checklist_execution/plan.md` (components C1–C15 · design rulings D1–D7 + D7a/D7b · reconciliation protocol §14)
> **Ticket:** `docs/planning/TICKETS.md:3029-3059` (Dev 3 · Milestone 4 · 5 SP · final gate before opening the platform) · **Executed checklist:** `docs/planning/PRODUCTION_READINESS.md` (369 lines · 156 §1–§8 rows + 17 §9 items · Launch Gate rule at `:12`)
> **Ledger:** `ai/plans/milestone_4/production_launch_checklist_execution/deferred-items.md` (pre-seeded in this planning session with resolved-pointer rows D1–D17) · **Outcome:** `ai/plans/milestone_4/production_launch_checklist_execution/outcome/` (research-00…research-10 incl. 08a/08b/08c — the pre-absorbed, verified evidence base)
> **Scope ruling (governing, specs §0):** evidence assembly + a small evidence-backed set of gap-closers + honest reconciliation of false-as-written rows + drills with filed evidence + sign-off collection. This ticket does NOT re-implement the platform, does NOT re-verify green suites by re-reading code, and does NOT absorb its 8-SP load-testing sibling. Exactly three row dispositions exist: ✅ (evidence executed and recorded), ☐ WHY + named owner (waived-with-sign-off), or FAIL (launch blocked, `PRODUCTION_READINESS.md:12`).

---

## Non-Negotiable Execution Protocol

1. **Pre-Execution Outcome Knowledge Read:** before executing ANY task, read ALL existing files in `ai/plans/milestone_4/production_launch_checklist_execution/outcome/` in lexical order (research-00…research-10 incl. 08a/08b/08c are the pre-absorbed knowledge base). NEVER repeat the completed research wave. Re-spot-check every citation before transcribing a ✅ (specs §8 assumption (c)).
2. **Per-File Quality Verification Loop:** every created/modified file passes `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0) BEFORE it is imported or used elsewhere. The script runs `tsgo → oxlint → biome:check → lint:type-aware → check:duplicates` progressively, short-circuiting at the first failure, and auto-discovers/prints the applicable `AGENTS.md` + `.agents/instructions/*.instructions.md` files.
3. **Test Execution:** single test files run via `bun run test/scripts/run-test.ts <path>` (mandatory log capture — NEVER raw `bun test` on a single test file); the whole journey layer via `bun run test/scripts/run-test.ts test/workflows` (`test/workflows/AGENTS.md:100-107`) — raw `bun test` is NEVER sanctioned in any form: the bunfig preload `test/scripts/test-runner-guard.ts` hard-blocks every direct `bun test` invocation unless `KOTTABY_TEST_RUNNER_OK=1` (set only by the approved runners); server-lane GraphQL files via `bun run test:graphql <path>` (explicit paths); cron suites via `bun run test:cron`. DB probes: `runInRollback` + `tx` to every repository call, try/catch + `expectRepoError` with per-leg SAVEPOINT brackets — NEVER `expect(...).rejects.toThrow()` inside `runInRollback` (`runInRollback` has no savepoint of its own; the bracket is mandatory — docblock precedents `backend/db/test/repo/billing/wallet.repository.test.ts:15`, `backend/db/test/logic/billing/financial-immutability.test.ts:16-18`). Journeys: NO `runInRollback`, committed fixtures + registry-tracked cleanup, spied fanout transports, DIAGRAMS.md Mermaid entry validated via `bun run validate:mermaid`.
4. **Semantic Review:** every implementation task self-reviews against the semantic checklist (race conditions; env registration via `backend/lib/env.ts` cached config + `resetEnvironmentCache()` in tests that mutate env — there is NO `env-config-keys.ts`, do not invent one; dead code; cross-layer imports; enums as VALUE imports when used at runtime; deferred-item ledgering).
5. **Post-Task Outcome File:** write `ai/plans/milestone_4/production_launch_checklist_execution/outcome/<task-id>-outcome.md` (findings, exact anchors touched, cross-file dependencies, carry-overs) BEFORE the next task begins. Drill evidence (DR timing table, `restore-report-<stamp>.json` copy, friction log, load artifacts) files here (REQ-009 AC-2).
6. **Checkbox Tracking:** `[ ]` → `[x]` only when ALL subtasks (QL/TE/SEC/SR/IV) of the task are complete. No partial flips.
7. **Ledger Discipline:** `deferred-items.md` is resolved-pointer only — the final gate is `grep -cE '^\s*\|.*(❌|⚠️)' deferred-items.md` = 0 (row-scoped; the legend lines contain the symbols by design). Every checklist ☐ WHY names its owner AND signatory; a waiver without a signatory is a FAIL.
8. **Drizzle conventions:** custom SQL (`backend/db/migration/14-prevent-users-delete.sql`) ships via **`bun db migrate`** — the authored source auto-bundles into `backend/drizzle/<stamp>_custom_…/` via `backend/db/scripts/applyCustomMigrations.ts`; the plain schema changes (Drizzle `index()` for the four verified unindexed FK columns — `broadcasts.sent_by_id`/`stopped_by_id`, `subscription_purchase_idempotency.subscription_id`, `session_request_idempotency.session_id`) ship via **`bun run db push`**. Gate tooling NEVER clears any cache; `--fresh` deletes `.launch-gate-state.json` only.

**Mandatory 5-stage subtask pipeline (strict order) for EVERY implementation task X.Y:** `X.Y.QL` (per-file sub-loop) → `X.Y.TE` (test engineering — for pure-orchestration scripts this IS the runner's own validation runs) → `X.Y.SEC` (security & tenancy audit — applies where the task exposes a surface; mark n/a otherwise) → `X.Y.SR` (semantic review — always) → `X.Y.IV` (instruction verification — always). No skipping ahead: fix the failing stage before running the next.

**Applicable rule files (auto-discovered by `sub-loop.ts`; read before fixing):** root `AGENTS.md` · `backend/AGENTS.md` + `backend/db/schema/AGENTS.md` (migration + push policy + static-assertions home) · `backend/db/test/AGENTS.md` + `backend/db/test/logic/AGENTS.md` (logic-tier probes; the `shared/` sub-directory rule at `:15,48`) · `backend/enum/AGENTS.md` (census) · `backend/services/AGENTS.md` + `backend/graphql/AGENTS.md` (limiter wiring) · `frontend/AGENTS.md` + `frontend/graphql/AGENTS.md` + `frontend/graphql/test/AGENTS.md` (wire pins) · `test/workflows/AGENTS.md` (journeys) · `backend/ws/AGENTS.md` (sidecar tests: `port: 0` + mandatory afterAll shutdown at `:35`) · `.agents/instructions/{backend,frontend,tests}.instructions.md` per the template's layer-to-instructions mapping.

---

## Implementation Overview

### Implementation Strategy
- **Three phases mirroring specs §0 / design §1:** (1) **HARNESS** — the 9-stage resumable launch gate under `scripts/launch/` (Phase 1); (2) **GAP-CLOSERS + AS-BUILT RECONCILIATION** — one small closer per plan §5 component, then gate execution and honest checklist transcription (Phases 2–3); (3) **DRILLS + REPORT + SIGN-OFF** — DR/load drills with filed evidence, final report emission, human sign-off, final gates (Phases 4–5).
- **Run-and-record dominates:** the research-10 modality census classifies all 173 rows (119 AUTOMATED-TEST / 22 SCRIPT-PROBE / 12 MANUAL-DRILL / 8 DOC-SIGNOFF / 17 §9 items). Existing green suites are invoked through their canonical runners and recorded — never rebuilt, never re-verified by re-reading code.
- **Honesty rules:** rows flip ONLY after their owning stage is green in a gate run (design §14 — the gate's per-row report is the edit ticket); false-as-written rows are re-worded to as-built semantics with code pointers (REQ-002); MANUAL-DRILL/DOC-SIGNOFF rows are marked from the EXISTENCE of filed artifacts, never auto-passed (REQ-001 AC-5).

### Development Approach
- **Testing strategy:** the harness self-verifies (`--dry-run` registry walk, state-file round-trip, resume short-circuit, redaction check — task 1.6); each gap-closer is a small test at its natural tier (PG probe in `runInRollback`, static census, journey per `test/workflows/AGENTS.md`, dev-server wire pin, config test); drills file evidence into `outcome/` and their rows flip from artifact existence.
- **Sequencing rationale:** harness first — `launch-checklist.ts` is the row→suite manifest every later task, the report, and the sign-off cite; closers second — the gate's stages cannot go green until the new probes/tests exist; reconciliation third — flips are gated on green stages; drills/report/sign-off last — evidence must exist before the final `VERDICT`. Phase 3's first gate run legitimately marks MANUAL-DRILL rows ☐ (drill evidence does not exist yet); the Phase 4 re-run with filed evidence produces the final `VERDICT: PASS` and proves the reproducibility criterion (a second run reproduces per-row verdicts).

---

## Task 0: Pre-Implementation Baseline

### 0.1 Record Error Baseline & Verify the Deferred-Items Ledger

- [ ] 0.1 [Record baseline + verify the pre-seeded ledger]
  - Run and capture counts into `/tmp/baseline-*.txt`: `bun tsgo 2>&1 | grep "error TS" | wc -l > /tmp/baseline-tsgo.txt` · `bun biome:check 2>&1 | grep -c "warn" > /tmp/baseline-biome.txt` · `bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json`.
  - VERIFY the ledger `ai/plans/milestone_4/production_launch_checklist_execution/deferred-items.md` — it ships PRE-SEEDED in this planning session with resolved-pointer rows **D1–D17** (specs §2.2 D1–D11 canonical + plan-introduced D12–D17): confirm every row carries its disposition target, owner, and evidence-based rationale; do NOT re-create it from the template.
  - Write `ai/plans/milestone_4/production_launch_checklist_execution/outcome/0-baseline-outcome.md` with the captured numbers (the task 5.1 comparator).
  - _Requirements: REQ-000_

### 0.2 Phase 1.5 Plan-Review Gate (BLOCKING — executed in this planning session)

- [x] 0.2 [@plan-review — zero violations required before implementation begins]
  - The trio (`specs.md` + `plan.md` + this `tasks.md`) was reviewed via the `@plan-review` skill during plan assembly (this planning session); the verdict + violation inventory is filed at `ai/plans/milestone_4/production_launch_checklist_execution/outcome/plan-review-R1.md`.
  - The review MUST ratify the governing scope reconciliation (specs §0: run-and-record; the three-disposition waiver philosophy; the modality census) and the design's conflict resolutions (the custom-SQL shipping lane for the users-delete trigger; D7b INV-B6 existing wire coverage — run-and-record, no duplicate file).
  - IF the outcome file reports violations: fix the plan files and re-run until zero violations — implementation tasks MUST NOT start before that state is recorded.
  - _Requirements: REQ-000_

---

## Phase 1: Launch Gate Harness (`scripts/launch/` — NOT `test/launch/`)

> `scripts/` owns orchestration CLIs; `test/` directories are bun-test layers governed by per-dir AGENTS.md (design §1). Proven patterns: state-file/resume/lock at `scripts/quality-gate.ts:14,19-24,203,207`; thin-composer at `scripts/health/sub-loop.ts:71-73`; stamped report name at `scripts/ops/restore-shared.ts:31`; `VERDICT:` print at `scripts/ops/restore-verify.ts:213`; probe precedent at `scripts/verify-unique-constraints.ts:2-11`.

### 1.1 `scripts/launch/shared/launch-types.ts` (NEW — model `scripts/health/shared/`)

- [ ] 1.1 [Create the harness type module — plan C4]
  - Export: `LaunchStage` (9 literals `s1-data-integrity`…`s9-gate`), `LaunchModality` (`"AUTOMATED-TEST"|"SCRIPT-PROBE"|"MANUAL-DRILL"|"DOC-SIGNOFF"`), `LaunchGateState {stage; owner:"launch-gate"; lifecycle:"FRESH"|"IN_PROGRESS"|"DONE"; lastRun}` (plan §6.1), `LaunchReportRow` (`{rowId, section, modality, command, exitStatus, result, evidenceRef, timestamp}` — the REQ-001 AC-4 tuple plus `section`/`result`), `StageResult`, `RowDisposition = "PASS"|"WAIVED"|"FAIL"`, `ProbeLine`, and `LaunchRow` (with optional `waiver?: {why: string; owner: string}`). Deep imports via the `@/` alias; no barrel.
  - [ ] 1.1.QL **Quality Loop:** sub-loop on the file (exit 0).
  - [ ] 1.1.TE **Test Engineering:** `bun tsgo` clean; the type shapes are consumed and validated by 1.2's compile (pure types — no runtime yet).
  - [ ] 1.1.SEC **Security & Tenancy Audit:** n/a — pure types, no surface.
  - [ ] 1.1.SR **Semantic Review:** types match plan §6 report JSON exactly (the D7 redaction allowlist derives from these fields); zero dead exports.
  - [ ] 1.1.IV **Instruction Verification:** root `AGENTS.md` (path-alias + deep-import rules).
  - _Requirements: REQ-001_

### 1.2 `scripts/launch/launch-checklist.ts` (NEW — the 173-row single source of truth)

- [ ] 1.2 [Author the row registry: rowId → section → modality → command/oracle → evidenceRef — plan C2]
  - `export interface LaunchRow {readonly rowId; readonly section: 1|2|3|4|5|6|7|8|9; readonly modality: LaunchModality; readonly command; readonly evidenceRef; readonly waiver?}` + `export const LAUNCH_CHECKLIST: readonly LaunchRow[]` + `export const STAGES` + `export function rowsForStage(stage)`. Row counts exactly per the design §4 stage table: §1 17 · §2 25 · §3 17 · §4 16 · §5 34 · §6 7 · §7 7 · §8 33 · §9 17.
  - AUTOMATED-TEST rows carry their canonical runner command (`bun run test:db`, `test:services`, `test:graphql`, `test:cron`, `bun run ops:db-restore-verify`, `bun run test/scripts/run-test.ts <path>` for journeys/probes, `scripts/launch/*` + `scripts/load/*` for probes); `evidenceRef` = the `run-test.ts` captured log path, probe output, or filed drill artifact (REQ-001 AC-6).
  - Waiver-shaped rows carry `{why, owner}` (3.3.3→D1; 8.26 runtime half→D2; §4 hardening rows→D5/D14/D15; 5.1.1/5.1.2→D10); the s5 INV-matrix report step consumes `docs/specs/state-machine-invariants.md` as its row source — this gate RUNS and RECORDS the sibling wave's suites, never duplicates them (REQ-007 AC-1).
  - [ ] 1.2.QL **Quality Loop:** sub-loop on the file (exit 0).
  - [ ] 1.2.TE **Test Engineering:** the 1.6 `--dry-run` walk validates the registry: 173 rows resolve, per-stage counts match, every command's target file exists.
  - [ ] 1.2.SEC **Security & Tenancy Audit:** n/a — pure data registry.
  - [ ] 1.2.SR **Semantic Review:** row IDs map 1:1 to `PRODUCTION_READINESS.md`; no invented suite paths; waiver rows all carry owners.
  - [ ] 1.2.IV **Instruction Verification:** root `AGENTS.md` (canonical runner commands).
  - _Requirements: REQ-001, REQ-007_

### 1.3 `scripts/launch/launch-report.ts` (NEW — stamped writer)

- [ ] 1.3 [Implement the machine launch report writer + verdict computation — plan C3/D7]
  - `export function writeLaunchReport(rows: readonly LaunchReportRow[], stages: readonly StageResult[]): string` (returns the written path; emits `docs/planning/launch-report-<UTC-stamp>.json` per plan §6.2 shape, prints the final `VERDICT: PASS|FAIL` line) + `export function computeVerdict(rows): "PASS"|"FAIL"` — FAIL iff any row result is FAIL or any waiver lacks a signatory (REQ-001 AC-4/AC-7).
  - **D7 redaction:** the serializer allowlists ONLY the report fields (`rowId, section, modality, command, exitStatus, result, evidenceRef, timestamp`, `stages`, `waivers`, `verdict`, `generatedAt`) — never env values, secrets, tokens, or connection strings; evidence refs are repo-relative paths.
  - [ ] 1.3.QL **Quality Loop:** sub-loop on the file (exit 0).
  - [ ] 1.3.TE **Test Engineering:** runner self-validation — write a report from a fixture row set into a temp path, re-read, assert field parity + redaction (a planted `secret` key must not survive); `computeVerdict` truth table (all-PASS→PASS; one FAIL→FAIL; unsigned waiver→FAIL; signed waiver→PASS).
  - [ ] 1.3.SEC **Security & Tenancy Audit:** the redaction allowlist IS the audit — no env/secret/channel leakage into a repo-committed artifact.
  - [ ] 1.3.SR **Semantic Review:** verdict semantics match the Launch Gate rule (`PRODUCTION_READINESS.md:12`) exactly; no dead exports.
  - [ ] 1.3.IV **Instruction Verification:** root `AGENTS.md`; ops stdout-line-as-record pattern preserved for printed lines.
  - _Requirements: REQ-001, REQ-011_

### 1.4 `scripts/launch/launch-gate.ts` (NEW — thin CLI) + state/resume/lock + D7a lock exemption

- [ ] 1.4 [Implement the resumable 9-stage gate + the process-lock timeout exemption — plan C1/C9]
  - Thin CLI `main(): Promise<number>` reading argv `--fresh` (deletes `.launch-gate-state.json` ONLY — never any cache) and `--dry-run`; body `await withProcessLock("launch-gate", runLaunchGate)` (import from `@/scripts/lib`, pattern `scripts/quality-gate.ts:12,207`). State persists to repo-root `.launch-gate-state.json` after each stage; resume starts at `STAGES.indexOf(state.stage)` (`:203` pattern); per stage: spawn the mapped commands, stream output, append per-row results, halt on the failing rowId + exit code (REQ-001 AC-2/AC-3/AC-7). MANUAL-DRILL/DOC-SIGNOFF rows are marked from the EXISTENCE of their filed evidence artifact — never auto-passed (AC-5).
  - **D7a (C9):** `scripts/lib/process-lock-helpers.ts` `isTimeoutExempt` (`:58`) gains `d.includes("launch-gate")`, and the exempt-task list comment at `scripts/lib/process-lock.ts:159` is updated in the same change — without it the multi-hour gate is killed at the 5-minute lock timeout.
  - Logging: structured diagnostics via `@/backend/lib/logger`; printed record/evidence lines use bare `console.log` — lawful for `scripts/**/*.ts` under the ESLint `no-console` carve-out (`eslint.config.mjs:237,244`; ops precedents `scripts/quality-gate.ts:68,142`, `scripts/ops/restore-verify.ts:99-100,213`). `backend/**` keeps the hard no-`console.*` rule.
  - [ ] 1.4.QL **Quality Loop:** sub-loop on both touched files (exit 0).
  - [ ] 1.4.TE **Test Engineering:** runner self-validation (via 1.6): state-file round-trip, resume-from-stage short-circuit (passed stages not re-run), `--fresh` deletes state only, failing-row halt with rowId + exit code, lock exemption matches `launch-gate` and still rejects non-exempt names.
  - [ ] 1.4.SEC **Security & Tenancy Audit:** single lock-holder writes the state file (TOCTOU assessment, plan §8); the exemption predicate stays narrow (exact `launch-gate` substring, no broadening).
  - [ ] 1.4.SR **Semantic Review:** gate serialization per AGENTS.md parallel-runner safety (canonical locked runners only); no cache writes; `--dry-run` performs zero suite spawns.
  - [ ] 1.4.IV **Instruction Verification:** root `AGENTS.md` (quality-gate/lock conventions; cache-preservation rule).
  - _Requirements: REQ-001_

### 1.5 Probe script skeletons (NEW — plan C5/C6: `probe-decisions.ts`, `probe-constraints.ts`, `secrets-scan.ts`, `verify-cron.ts`)

- [ ] 1.5 [Create the four probe CLIs as runnable skeletons wired into the stage registry]
  - Each file under `scripts/launch/`: arg parsing, DB handle via the existing client (read-only), `ProbeLine` emission (`{rowId, result: "PASS"|"FAIL", detail}`), exit 0 iff all lines PASS, `@/backend/lib/logger` logging. Skeleton inventory = connection probe + one placeholder line per mapped row; the FULL assertion inventories land in tasks 2.8/2.10/2.14/2.16 (one per probe).
  - `verify-cron.ts` reads its bearer from the environment (never argv, never the report); `secrets-scan.ts` takes an explicit target path list (used against the launch report before commit, D7).
  - [ ] 1.5.QL **Quality Loop:** sub-loop on each file (exit 0).
  - [ ] 1.5.TE **Test Engineering:** runner self-validation — each skeleton exits 0 against a reachable dev DB with all-PASS placeholder lines, non-zero on a planted FAIL line, and a named connection-error row (never a silent skip, plan §11).
  - [ ] 1.5.SEC **Security & Tenancy Audit:** zero writes against the DB (read-only probes); bearer/secret handling per plan §10.
  - [ ] 1.5.SR **Semantic Review:** probes are stage tools, not tests — no `test/` placement; no new dependencies.
  - [ ] 1.5.IV **Instruction Verification:** root `AGENTS.md` (scripts/ owns orchestration CLIs).
  - _Requirements: REQ-001, REQ-006, REQ-007, REQ-010, REQ-012_

### 1.6 Harness Self-Verification (`--dry-run` — the gate's own validation)

- [ ] 1.6 [Validate the harness end-to-end without executing suites]
  - `bun run scripts/launch/launch-gate.ts --dry-run`: walks all 173 rows validating registry resolvability + per-stage counts (17/25/17/16/34/7/7/33/17), validates state-file round-trip + resume short-circuit + `--fresh` scope, and writes a redacted sample report to a temp path (deleted after). Fix every finding before Phase 2.
  - [ ] 1.6.QL **Quality Loop:** sub-loop on any file touched by fixes (exit 0).
  - [ ] 1.6.TE **Test Engineering:** this run IS the TE — capture the dry-run inventory (per-stage row counts, waiver rows, drill rows) into `outcome/1.6-harness-outcome.md`.
  - [ ] 1.6.SEC **Security & Tenancy Audit:** confirm the dry-run performs zero suite spawns and zero cache writes.
  - [ ] 1.6.SR **Semantic Review:** registry vs `PRODUCTION_READINESS.md` row IDs reconciled section by section.
  - [ ] 1.6.IV **Instruction Verification:** root `AGENTS.md`.
  - _Requirements: REQ-001_

---

## Phase 2: Gap-Closers (one task per plan §5 component — REQ-003..REQ-008, REQ-010, REQ-012)

### 2.1 `prevent_users_delete` GUC-gated trigger + test-path opt-out pins + data-integrity PG probe (plan C8 + C12 + D1)

- [ ] 2.1 [Close row 1.1.1's DB-layer hole and prove the guard fires]
  - Author `backend/db/migration/14-prevent-users-delete.sql` (next ordinal after `13-teacher-was-online-before-lock.sql` — verified): idempotent `CREATE OR REPLACE FUNCTION prevent_users_delete()` + `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` (mirror `3-immutability-triggers.sql`), BEFORE DELETE ON users → `RAISE EXCEPTION`, with the GUC check `IF coalesce(current_setting('kottaby.users_delete_guard', true), '') <> 'off' THEN RAISE …` — guard ON when the GUC is unset (production default; missing-ok `current_setting` idiom precedent `backend/db/migration/2-functions.sql:4`). NO inline `--` comments inside SQL templates. Ship via **`bun db migrate`** — the authored source auto-bundles into `backend/drizzle/<stamp>_custom_14-prevent-users-delete/` via `backend/db/scripts/applyCustomMigrations.ts`; NOT `bun run db push` (push applies Drizzle-schema `.ts` changes only). No `inv-u4-grep-lock.test.ts` edit: its corpus walk covers production `.ts` files only (`:100,113-115` — the `.sql` source is never scanned) and the teardown helpers stay untouched.
  - **Test-path opt-out pins (2 one-line edits — ZERO test-helper/journey/backend-suite edits, plan D1):** `backend/db/client.ts:168` appends `-c kottaby.users_delete_guard=off` to the pg Pool's EXISTING startup `options` packet (beside `-c timezone=UTC`) when `TEST_CI === "1" || TEST_SERVER === "1"`, with the same production fail-fast guard shape as `app/api/graphql/rate-limit.ts:34-48` (`TEST_SERVER` is set universally by the `backend/db/test/ensure-env.ts` bunfig preload, CI's `.env.test`, and `test/scripts/run-server-tests.ts:187`); `backend/db/pglite-pool.ts` pins the same session opt-out beside `SET TIME ZONE 'UTC'` (`:199`). Verified seam note: no clean single test-DB provisioning seam exists — `bun run db migrate` (`scripts/dbActions/cli-entry.ts` → `backend/db/scripts/migrate.ts:24`) is the shared prod/CI path and the CI test DB is created by the `postgres:16` service container (`.github/workflows/ci.yml:213,280,349`) — hence the connection-time client pins. node-postgres `Pool` has no `afterCreate` hook (verified `@types/pg` `PoolConfig`, `node_modules/@types/pg/index.d.ts:49-60`), so the startup-options packet is the connection-time seam this client already uses.
  - Create `backend/db/test/logic/shared/data-integrity.probe.test.ts` (NEW `shared/` home per `backend/db/test/logic/AGENTS.md:15,48`; PG tier: `isPgliteProvider() ? describe.skip : describe`, pattern `financial-immutability.test.ts:314`; `runInRollback`; try/catch + `expectRepoError` with per-leg SAVEPOINT brackets): (a) `SELECT set_config('kottaby.users_delete_guard', 'on', true)` (transaction-local, auto-reverts at rollback) → fixture `DELETE FROM users` RAISEs; (b) the inherited test-path opt-out (guard `off`) lets the same DELETE proceed — teardown stays green; (c) environment-branched on trigger presence (pattern `audit-immutability.test.ts:339,427`): on push-provisioned DBs the trigger is absent → assert the FK-RESTRICT failure class instead. The `student_payments`/`teacher_transaction`/`audit_logs` trigger legs are run-and-record citations of `backend/db/test/logic/billing/financial-immutability.test.ts` + `backend/db/test/logic/audit/audit-immutability.test.ts` — NOT rebuilt here (REQ-003 AC-2).
  - [ ] 2.1.QL **Quality Loop:** sub-loop on the SQL file, both client files, and the probe (exit 0).
  - [ ] 2.1.TE **Test Engineering:** run `bun run test/scripts/run-test.ts backend/db/test/logic/shared/data-integrity.probe.test.ts`; then re-run the teardown-dependent layers (`bun run test/scripts/run-test.ts test/workflows`) proving the opt-out keeps every teardown callsite green with NO helper edits; run `bun run test:db` to prove the repo-tier suites stay green on migrate-provisioned DBs.
  - [ ] 2.1.SEC **Security & Tenancy Audit:** the guard has no actor carve-outs (GUC ON when unset — the production default); the client opt-out predicate fails fast when `NODE_ENV === "production"` (mirror `rate-limit.ts:34-48`); an attacker with SQL access could DROP any trigger — the GUC adds no material weakening (recorded as the D17 signed launch note).
  - [ ] 2.1.SR **Semantic Review:** trigger idempotent (auto-bundler may re-apply); no `rejects.toThrow()` inside `runInRollback`; `tx` propagated to every repo call in the probe; `set_config(..., true)` is transaction-local so the guard auto-reverts at rollback.
  - [ ] 2.1.IV **Instruction Verification:** `backend/AGENTS.md` + `backend/db/schema/AGENTS.md` (push vs migrate) + `backend/db/test/AGENTS.md` + `backend/db/test/logic/AGENTS.md` (the `shared/` sub-directory rule at `:15,48`) + `.agents/instructions/backend.instructions.md` + `tests.instructions.md`.
  - _Requirements: REQ-003_

### 2.2 J1 — Admin Soft-Delete → History Preservation journey (plan C13)

- [ ] 2.2 [Author `test/workflows/admin/admin-delete-with-history.journey.test.ts` (row 1.1.4 — previously unasserted)]
  - Full `test/workflows/AGENTS.md` discipline (committed fixtures + registry-tracked cleanup + zero-residue re-probes, honest roles via the actor-context factory, NO `runInRollback): provision a student with committed session/report/payment/wallet-adjacent rows → admin soft-deletes (`setDeletedOnce`, audit `Delete`) → re-query every table: rows present and byte-identical → soft-deleted student login denied via the real governance gate → raw-SQL hard-delete probe on the fixture family: re-enable the guard with `set_config('kottaby.users_delete_guard', 'on', true)` (transaction-local) → trigger RAISE, row survives; environment-branched on trigger presence (pattern `backend/db/test/logic/audit/audit-immutability.test.ts:339,427`) — on push-provisioned DBs the trigger is absent, so the leg asserts the FK-RESTRICT failure class instead → admin reactivates (`deleted_at=null`, audit `Reactivate`, login restored). Teacher-side variant: earning rows survive teacher soft-delete.
  - **Fixture-teardown note (M4):** the DELETE-blocked ledger rows (`student_payments`/`teacher_transaction`) are torn down in `afterAll` inside `withImmutabilityTriggersSuspended([...])` — the repo-wide teardown convention (34 files, e.g. `test/workflows/billing/subscription-expiry.journey.test.ts:469`); the users rows need no suspension (the test-path GUC opt-out).
  - Add the matching Mermaid section to the admin domain's `DIAGRAMS.md`; validate via `bun run validate:mermaid`.
  - [ ] 2.2.QL **Quality Loop:** sub-loop on the journey file (exit 0).
  - [ ] 2.2.TE **Test Engineering:** run `bun run test/scripts/run-test.ts test/workflows/admin/admin-delete-with-history.journey.test.ts`; zero-residue verified; byte-identity asserted on re-queried rows (the 1.1.4 oracle).
  - [ ] 2.2.SEC **Security & Tenancy Audit:** denials asserted via translated substrings (`getServerTranslations("en").errorsTranslations`); no permission bypasses.
  - [ ] 2.2.SR **Semantic Review:** extends the `admin-user-lifecycle.journey.test.ts` pattern (research-01 harness rec 2) — no duplicated scaffolding; assertion set = plan §9 J1.
  - [ ] 2.2.IV **Instruction Verification:** `test/workflows/AGENTS.md` (journey discipline + cleanup rules) + `.agents/instructions/tests.instructions.md`.
  - _Requirements: REQ-003_

### 2.3 Retention anti-drift static census (plan C12 — rows 1.4.1/1.4.3)

- [ ] 2.3 [Author `backend/db/test/logic/shared/retention-anti-drift.test.ts`]
  - DB-free fs-scan mirroring `audit-immutability.test.ts:208-268`: assert zero `.delete(`/raw DELETE paths against `session`, `reports`, `recitation`, `home_work`, `evaluations` across `backend/db/repo/**` + `app/api/cron/` + `scripts/ops/`; allowlist exactly `lesson.repository.ts:101` (curriculum delete) and `notification.repository.ts:346` (REQ-003 AC-4). Cross-cutting home: `backend/db/test/logic/shared/` — the AGENTS-documented home for cross-cutting infra + integrity tests (`backend/db/test/logic/AGENTS.md:15,48`); the directory is created by this task and needs NO AGENTS.md Layout edit (`shared/` is already documented there).
  - [ ] 2.3.QL **Quality Loop:** sub-loop on the file (exit 0).
  - [ ] 2.3.TE **Test Engineering:** run via `bun run test/scripts/run-test.ts backend/db/test/logic/shared/retention-anti-drift.test.ts`; prove the scanner trips on a planted temporary `.delete(` (then remove it) — the census must be able to fail.
  - [ ] 2.3.SEC **Security & Tenancy Audit:** n/a — static census.
  - [ ] 2.3.SR **Semantic Review:** allowlist entries re-spot-checked against live code before transcription.
  - [ ] 2.3.IV **Instruction Verification:** `backend/db/test/AGENTS.md` + `backend/db/test/logic/AGENTS.md` (the `shared/` layout rule at `:15,48`) + backend/tests instructions.
  - _Requirements: REQ-003_

### 2.4 Notification-type inventory census (plan C12 — row 3.4.5)

- [ ] 2.4 [Extend `backend/enum/notifications/notification-type.enum.test.ts` to 10 members + author the census test]
  - FIRST extend the existing test's `CANONICAL_VALUES` (`:17`, currently 9 members) to the 10-member set (`backend/db/schema/enums.ts:101-112` — adding `applicant_outcome` beside `session_dispute_opened`/`session_dispute_resolved`), extending-not-duplicating (L9 ruling: the pgEnum + TS mirror carry 10 while the pin carries 9 — the stale pin is the drift). THEN author `backend/enum/notifications/notification-type-census.test.ts` deriving its member list from `Object.values(NotificationType)` and asserting every member has ≥1 production emitter and ≥1 exercising test (REQ-005 AC-4).
  - [ ] 2.4.QL **Quality Loop:** sub-loop on both files (exit 0).
  - [ ] 2.4.TE **Test Engineering:** run via `bun run test/scripts/run-test.ts backend/enum/notifications/notification-type.enum.test.ts` then the census test; the census must fail on a planted orphan member (then remove it).
  - [ ] 2.4.SEC **Security & Tenancy Audit:** n/a — static census.
  - [ ] 2.4.SR **Semantic Review:** count re-baselined 7→10 per REQ-002 AC-6; emitter/test oracles walk real corpus paths; no duplicated canonical list (derive, don't re-hardcode).
  - [ ] 2.4.IV **Instruction Verification:** `backend/enum/AGENTS.md` + `backend/AGENTS.md` + `.agents/instructions/backend.instructions.md`.
  - _Requirements: REQ-005_

### 2.5 J2 — WS Reconnect Catch-Up journey + backoff pin (plan C13 — rows 3.2.3/3.2.4, 3.4.1)

- [ ] 2.5 [Author `test/workflows/notifications/reconnect-catchup.journey.test.ts` + `frontend/hooks/notifications/use-notification-realtime.helpers.test.ts`]
  - Journey (full `test/workflows/AGENTS.md` discipline): boot the real sidecar via `startNotificationWsServer` on `port: 0` with a RECORDING-AND-FORWARDING transport wrapper around the real `InProcessTransport` (`backend/services/notifications/realtime` export, exercised at `backend/ws/notification-ws-server.test.ts:42`; tier pattern `notification-ws-server.test.ts:499`) — the wrapper records every dispatch for telemetry AND delivers in-process, so the frame provably arrives on the new socket while dispatch evidence is captured (M5 ruling: a pure spy would swallow the delivery and contradict the "frame arrives on the NEW socket" leg); connect a real Bun `WebSocket` client; kill the socket; emit a notification while disconnected (row persisted, no frame — 3.4.3 seam); reconnect → the catch-up refetch surfaces the missed row through the real inbox path (`use-notification-realtime.socket.ts:74-100` client seam) with the correct unread count (3.2.4); second emission → frame arrives on the NEW socket (3.2.3); oracle: a session row under observation is byte-unchanged across the disconnect window (the 3.2.1/3.2.2 artifact); sibling recipient's inbox rows + frames untouched (no fan-out leakage — sibling-silence + inbox row-count deltas, pattern `notification-ws-server.test.ts:517-541`). Record the emit→frame loopback latency (3.4.1 — a recorded number, not a CI threshold). The sidecar is shut down in `afterAll` (`backend/ws/AGENTS.md:35` — never leave a listener behind, never occupy 3000/5432).
  - Pure-function companion: backoff-curve + abort-semantics pin in `use-notification-realtime.helpers.test.ts` (research-03 harness rec).
  - Add the matching Mermaid section to the notifications domain's `DIAGRAMS.md`; validate via `bun run validate:mermaid`.
  - [ ] 2.5.QL **Quality Loop:** sub-loop on both files (exit 0).
  - [ ] 2.5.TE **Test Engineering:** run `bun run test/scripts/run-test.ts test/workflows/notifications/reconnect-catchup.journey.test.ts` then the helpers test; zero-residue re-probes; sidecar shutdown verified (no lingering listener).
  - [ ] 2.5.SEC **Security & Tenancy Audit:** no fan-out leakage to sibling recipients (silence + row-count deltas asserted); everything stays in-process — nothing reaches real email/SMS/push/Redis/FX.
  - [ ] 2.5.SR **Semantic Review:** the sidecar is push-only (`notification-ws-server.ts:34`) — "session survives disconnect" is proven as DB-persistence + notification-lane reconnect, never as a session socket.
  - [ ] 2.5.IV **Instruction Verification:** `test/workflows/AGENTS.md` + `backend/ws/AGENTS.md:35` (ephemeral port + mandatory afterAll shutdown) + `frontend/AGENTS.md` + tests/frontend instructions.
  - _Requirements: REQ-005_

### 2.6 Login rate limiter (plan C10 — row 4.2.5)

- [ ] 2.6 [Ship `loginAccountLimiter` + env registration + resolver wiring + gateway wire test]
  - `backend/lib/ratelimit.ts`: add `loginAccountLimiter()` — a FACTORY returning a `RateLimiterConfig` (default 5 / 15 min, key `login:{normalized-email}`) whose limit/window are resolved lazily INSIDE each check (reads the env-cached config per check, so `resetEnvironmentCache()` (`backend/lib/env.ts:460`) is observable in override tests — no module-scope const) + `export function isRateLimitTestBypass(): boolean` factored FROM `app/api/graphql/rate-limit.ts:34-48` (TEST_CI/TEST_SERVER skip with the production fail-fast guard) — that file refactors to consume the single-sourced helper. ACCOUNT-keyed only: the key derives from the mutation input's login email (trim + lowercase); NO IP-keyed limiter — the GraphQL Context exposes no client IP (`backend/graphql/gqlContextFactory.ts:49-99`), transport-level IP throttling stays the existing gateway-wide limiter (`app/api/graphql/rate-limit.ts:56`, recorded as the row's transport-tier evidence), and a login-specific per-IP limiter folds into D14.
  - `backend/lib/env.ts`: add `loginRateLimitMax`/`loginRateLimitWindowMs` to the cached config via `parsePositiveIntegerEnv(process.env.LOGIN_RATE_LIMIT_*, DEFAULT_*)` (pattern `:405-413`); tests that mutate env MUST call `resetEnvironmentCache()` (`:460`).
  - `backend/graphql/mutation/auth.mutation.ts` login resolver (`:80-90`): check the account limiter BEFORE `AuthService.login` (throttle-before-compare, `backend/lib/gateway/cron-endpoint.ts:119,131`); exceeded ⇒ `throw new RateLimitExceededError(…)` (code `RATE_LIMIT_EXCEEDED`, `backend/lib/errors.ts:186`) with the message resolved via `ctx.t("errors")` → `rateLimitExceeded` (the parity-pinned key at `shared/locale/en/errors/index.ts:9`; translated-string precedent `backend/lib/gateway/cron-endpoint.ts:131`). Row 4.2.5's "password reset" limb is re-worded — no forgot-password endpoint exists (only admin-initiated reset).
  - `frontend/graphql/test/gateway/login-rate-limit.test.ts` (NEW, plan C14): in-process built-schema suite — burst past threshold with bypass flags unset (env mutated + `resetEnvironmentCache()`) ⇒ `extensions.code === "RATE_LIMIT_EXCEEDED"`; flags restored in `finally`. The existing dev-server auth battery staying green IS the bypass-honored pin.
  - [ ] 2.6.QL **Quality Loop:** sub-loop on all touched files (exit 0).
  - [ ] 2.6.TE **Test Engineering:** extend `backend/lib/ratelimit.test.ts` — first-pass/block/window-reset/key isolation for the account limiter (incl. normalization: `Foo@X.com` and `foo@x.com` share one bucket) + `isRateLimitTestBypass` prod-guard + an env-override leg proving the lazy factory picks up a mutated limit after `resetEnvironmentCache()`; run the gateway test via `bun run test:graphql frontend/graphql/test/gateway/login-rate-limit.test.ts`.
  - [ ] 2.6.SEC **Security & Tenancy Audit:** account keying prevents cross-account lockout amplification; limiter is fail-open in-memory per-instance (distribution via `@upstash/redis` + per-account lockout + login-specific per-IP limiter stay D14).
  - [ ] 2.6.SR **Semantic Review:** SDL freeze intact (`schema-surface.test.ts` + allowlist walk green UNEDITED); the only wire delta is the existing `RATE_LIMIT_EXCEEDED` code with a localized message.
  - [ ] 2.6.IV **Instruction Verification:** `backend/services/AGENTS.md` + `backend/graphql/AGENTS.md` + `frontend/graphql/AGENTS.md` + backend/frontend/tests instructions.
  - _Requirements: REQ-006_

### 2.7 Auth/CSRF posture pins (plan C11 — rows 4.1.3/4.2.4)

- [ ] 2.7 [Pin the expired-token and cookie-contract guarantees]
  - `backend/lib/auth/jwt.test.ts` (EDIT): expired-token pin — sign with a past `exp`, assert `verifyAccessToken`/`verifyRefreshToken` return `null` (the docblock at `:7` claims it; no test signs one today); optional wire test presenting an expired Bearer.
  - `backend/lib/auth/cookies.test.ts` (EDIT): pin the serialized `HttpOnly; SameSite=Strict` flag string (`backend/lib/auth/cookies.ts:160`) — the CSRF posture pin. No token mechanism is invented (D12); row 4.2.4's re-wording lands in task 3.2 per REQ-002 AC-10.
  - [ ] 2.7.QL **Quality Loop:** sub-loop on both test files (exit 0).
  - [ ] 2.7.TE **Test Engineering:** run both via `bun run test/scripts/run-test.ts <path>`; boundary variants (exactly-now `exp`, refresh-vs-access cross-type replay stay covered by the existing battery).
  - [ ] 2.7.SEC **Security & Tenancy Audit:** these pins ARE the audit — tamper/cross-type/cookie-flag surfaces.
  - [ ] 2.7.SR **Semantic Review:** pins extend existing suites; no duplicated scaffolding.
  - [ ] 2.7.IV **Instruction Verification:** `backend/AGENTS.md` + `.agents/instructions/backend.instructions.md` + `tests.instructions.md`.
  - _Requirements: REQ-006_

### 2.8 DB-SSL config test + secrets-scan inventory (plan C11/C6 — rows 4.3.4/4.3.5)

- [ ] 2.8 [Ship `test/config/db-ssl.test.ts` and complete the `secrets-scan.ts` inventory]
  - `test/config/db-ssl.test.ts` (NEW): assert `shouldUseSsl` enables SSL for `sslmode=require`/Neon `DATABASE_URL` (`backend/db/client.ts:42-46,157`); record the `rejectUnauthorized: false` posture and the plain-`DATABASE_URL`-gets-no-SSL hazard as signed launch notes (the report + runbook carry them; production string MUST carry `sslmode=require` — REQ-012 AC-4, D15).
  - `scripts/launch/secrets-scan.ts`: complete the Phase-1 skeleton — automate the hardcoded-secret grep against the `backend/lib/env.ts` `requireEnv`/`getEnv` discipline and the placeholder-only `.env.example`; exit non-zero on literal secret assignments; also runnable against the launch report file before commit (D7).
  - [ ] 2.8.QL **Quality Loop:** sub-loop on both files (exit 0).
  - [ ] 2.8.TE **Test Engineering:** run `bun run test/scripts/run-test.ts test/config/db-ssl.test.ts`; secrets-scan self-check — passes on the current corpus, trips on a planted literal (then removed).
  - [ ] 2.8.SEC **Security & Tenancy Audit:** the secrets-scan IS the audit surface; the scan target list never includes secret files.
  - [ ] 2.8.SR **Semantic Review:** truth-table coverage of `shouldUseSsl` variants; no env values leaked into test output.
  - [ ] 2.8.IV **Instruction Verification:** root `AGENTS.md` + `.agents/instructions/tests.instructions.md`.
  - _Requirements: REQ-006_

### 2.9 §2 financial closers: escrow-denial wire pins + launch financial probe (plan C14 + C12 — rows 2.3.1/2.5.4, §2 CHECK constraints)

- [ ] 2.9 [Pin the denial codes over the wire and the named CHECK constraints at the DB tier]
  - `frontend/graphql/test/billing/escrow-denial-codes.test.ts` (NEW): dev-server `testClient` suite pinning `extensions.code` for `INSUFFICIENT_BALANCE` (`session-lifecycle.booking.ts:151-156`) and `WALLET_INSUFFICIENT_FUNDS` (`wallet.service.ts:301-305`) — modeled on `backend/graphql/test/session-booking-balance.test.ts:193-283`. Document the new `billing/` sub-directory under Layout in `frontend/graphql/test/AGENTS.md` (its new-sub-dir rule).
  - `backend/db/test/logic/billing/launch-financial-probe.test.ts` (NEW, pattern `wallet.repository.test.ts:476-518`): assert the named CHECK constraints raise (`students_balance_*_check` ×4, `wallet_balance_check`, `wallet_total_earning_check`, `teacher_transaction_amount_check`) and post-settlement ledger UPDATE/DELETE raise the trigger exceptions (`runInRollback`, try/catch + `expectRepoError`, each RAISE leg bracketed in its own SAVEPOINT — `runInRollback` has no savepoint of its own, so the bracket is mandatory; docblock precedents `backend/db/test/repo/billing/wallet.repository.test.ts:15` + `backend/db/test/logic/billing/financial-immutability.test.ts:16-18`).
  - [ ] 2.9.QL **Quality Loop:** sub-loop on both files + the AGENTS.md layout edit (exit 0).
  - [ ] 2.9.TE **Test Engineering:** run the wire suite via `bun run test:graphql frontend/graphql/test/billing/escrow-denial-codes.test.ts` and the probe via `bun run test/scripts/run-test.ts backend/db/test/logic/billing/launch-financial-probe.test.ts`.
  - [ ] 2.9.SEC **Security & Tenancy Audit:** denial payloads leak no balance internals; probe uses fixture-owned rows only.
  - [ ] 2.9.SR **Semantic Review:** "422" vocabulary re-mapped to GraphQL error codes per REQ-002 AC-11 — this pin is the wire half.
  - [ ] 2.9.IV **Instruction Verification:** `frontend/graphql/AGENTS.md` + `frontend/graphql/test/AGENTS.md` + `backend/db/test/AGENTS.md` + instructions.
  - _Requirements: REQ-004_

### 2.10 Deployed-schema constraint-inventory probe (plan C6 — REQ-007 AC-8)

- [ ] 2.10 [Complete `scripts/launch/probe-constraints.ts` — read-only deployed-schema diff]
  - Diff the launch DB's `pg_constraint`/`pg_trigger` names against the expected inventory: the 6 named wallet/student CHECK + unique constraints (`wallet_balance_check`, `wallet_total_earning_check`, `wallet_teacher_id_unique`, `teacher_transaction_amount_check`, 4× `students_balance_*_check`), both immutability trigger families present AND enabled, and the settlement-amended function — read-only, pattern `scripts/verify-unique-constraints.ts:2-11`.
  - [ ] 2.10.QL **Quality Loop:** sub-loop on the file (exit 0).
  - [ ] 2.10.TE **Test Engineering:** runner self-validation — PASS lines on the dev DB; FAIL line on a planted expected-name that does not exist (then removed).
  - [ ] 2.10.SEC **Security & Tenancy Audit:** zero writes; connection via the existing client only.
  - [ ] 2.10.SR **Semantic Review:** expected inventory matches the research-06 mapping table; no schema-code involvement.
  - [ ] 2.10.IV **Instruction Verification:** root `AGENTS.md`.
  - _Requirements: REQ-007_

### 2.11 J3 — Expired Subscription → Lane Zero → Booking Denied journey (plan C13 — rows 5.3.3/5.3.4/5.3.6 chained; delta legs)

- [ ] 2.11 [Author `test/workflows/billing/subscription-expiry-booking-denial.journey.test.ts` — the NEW delta legs only]
  - **Run-and-record first (H2 ruling):** the middle leg already exists green — `test/workflows/billing/subscription-expiry.journey.test.ts` steps 1–5 (`:493`–`:671`) chain funded purchase → real expiry sweep (`backend/services/billing/subscription-expiry.service.ts`) → lane zeroed → booking denied `SUBSCRIPTION_EXPIRED` (service + wire, ZERO writes) → sweep-replay idempotency. The gate runs and records that journey for rows 5.3.3/5.3.4 — NEVER rebuild it.
  - Full journey discipline for the NEW delta legs: funded control booking with TWO active subscriptions covering the lane → sweep expires one; covering subscription keeps the lane intact (skip path asserted — INV-B3 as-built) → the covering subscription expires too (backdate + sweep) → lane zeroed → booking denied `SUBSCRIPTION_EXPIRED` with ZERO session rows + reusable idempotency key (as-built precedence `backend/services/classes/session-lifecycle.booking.ts:139-149`, pinned at `session-lifecycle.booking.test.ts:520-535`; `INSUFFICIENT_BALANCE` fires only for a never-funded student — `backend/graphql/test/session-booking-balance.test.ts:194`; oracle vocabulary `:193-283`) → admin RENEW (`renewSubscription` — the source must be `expired` and the lane is credited, `backend/services/billing/subscription-admin.service.ts:22-36,299`; NOT extend, which requires an active row and shifts the window without crediting, `:159`) → lane credited → booking succeeds again on the renewed lane. This journey is the evidence the stale 5.3.3 deferral flip cites (task 3.2, REQ-002 AC-5). Add the matching Mermaid section to the billing domain's `DIAGRAMS.md`; validate via `bun run validate:mermaid`.
  - **D7b:** INV-B6 admin-extend wire coverage is the EXISTING `frontend/graphql/test/subscription-admin/subscription-admin.test.ts` (anonymous `:552`, non-admin `:594`, admin extend `:652`, admin renew `:670`) — run-and-record; NO new wire file (duplicating it would violate run-and-record + the duplicates gate).
  - [ ] 2.11.QL **Quality Loop:** sub-loop on the journey file (exit 0).
  - [ ] 2.11.TE **Test Engineering:** run `bun run test/scripts/run-test.ts test/workflows/billing/subscription-expiry-booking-denial.journey.test.ts` AND the existing expiry journey (the run-and-record spine); zero-residue re-probes; control-booking proves the lane was live pre-expiry; sweep idempotency (re-sweep → zero rows) asserted.
  - [ ] 2.11.SEC **Security & Tenancy Audit:** denial via translated substrings (`t.subscriptionExpired`); renew leg exercises the real admin role honestly.
  - [ ] 2.11.SR **Semantic Review:** assertion set = plan §9 J3 (delta legs); RENEW-not-extend semantics match `subscription-admin.service.ts:22-36` (extend requires active + shifts window without crediting).
  - [ ] 2.11.IV **Instruction Verification:** `test/workflows/AGENTS.md` + `.agents/instructions/tests.instructions.md`.
  - _Requirements: REQ-002, REQ-007_

### 2.12 §8 static decision closers: enum census + parity + A.7 pin + rubric constant pin (plan C12)

- [ ] 2.12 [Author the §8 static/probe test files + run-and-record row 8.3]
  - `backend/db/test/logic/shared/schema-registry-census.test.ts` (NEW `shared/` home per `backend/db/test/logic/AGENTS.md:15,48`): fs-walk asserting zero `pgEnum(` in domain schema files, registry count === 21, and byte-identical (order-sensitive) pgEnum↔TS-mirror parity closing the 13/21 mirror gap (assertion shape `backend/enum/notifications/notification-type.enum.test.ts:54-67`) — REQ-010 AC-3.
  - `backend/db/schema/users/users-governance.static-assertions.test.ts` (NEW — A.7 negative pin, REQ-010 AC-4): DB-free `getTableColumns`/`getTableConfig` assertions (pattern `backend/db/schema/classes/report-homework-schema.static-assertions.test.ts`) that users carries the governance columns (`isDeleted`/`suspended`/`isBlocked` + their timestamp columns) and students/teacher/parents/admin export NONE of them.
  - `shared/constants/evaluation-rubric.constants.test.ts` (NEW, beside `shared/constants/evaluation-rubric.constants.ts:18`): freeze `RUBRIC_PASS_THRESHOLD === 80` — the only pricing/threshold constant without an existing pin — following the `<file>.constants.test.ts` naming convention; the other three constants are run-and-record citations of the already-green pins (`shared/constants/session-fees.constants.test.ts:96-107,137-140` for `SESSION_CONFIRMATION_WINDOW_MS`/`SESSION_FEE_HIFZ`/`SESSION_FEE_TAJWEED`; `shared/constants/re-evaluation.constants.test.ts:53,105` for `RE_EVALUATION_FEE`) — REQ-010 AC-7. `launch-constant-pins.test.ts` is CANCELLED (would duplicate green coverage).
  - **Row 8.3 (handshake 23505) is run-and-record — NO new probe file:** `backend/db/test/logic/students/handshake-code-generation-locks.test.ts:255,280,376` already asserts the duplicate-INSERT SQLSTATE 23505 + `students_handshake_code_unique` (service guards bypassed, via the registration repository, inside `runInRollback` with `expectRepoError` + explicit savepoints); run it via `bun run test/scripts/run-test.ts backend/db/test/logic/students/handshake-code-generation-locks.test.ts` and record the output as the row's evidence (REQ-010 AC-2).
  - [ ] 2.12.QL **Quality Loop:** sub-loop on all three new files (exit 0).
  - [ ] 2.12.TE **Test Engineering:** run each via `bun run test/scripts/run-test.ts <path>`; the census must fail on a planted mirror drift (then removed); run-and-record the handshake-locks suite.
  - [ ] 2.12.SEC **Security & Tenancy Audit:** n/a — static pins.
  - [ ] 2.12.SR **Semantic Review:** pricing constant frozen before launch per research-08b harness rec 3; pgEnum import discipline (value imports where runtime-used); no duplicated green coverage (handshake + the three constants are citations, not rebuilds).
  - [ ] 2.12.IV **Instruction Verification:** `backend/db/test/AGENTS.md` + `backend/db/test/logic/AGENTS.md` (the `shared/` layout rule at `:15,48`) + `backend/db/schema/AGENTS.md` (static-assertions home) + `shared/AGENTS.md` + backend/tests instructions.
  - _Requirements: REQ-010_

### 2.13 Decision-census introspection probe (plan C5 — REQ-010 AC-1)

- [ ] 2.13 [Complete `scripts/launch/probe-decisions.ts` — read-only live-DB verification of the schema-shape rows]
  - Verify the ~11 schema-shape decision rows against the launch DB via `information_schema`/`pg_enum`/`pg_trigger` (generalizing `scripts/verify-unique-constraints.ts:2-11`): parents/students/notifications/audit_logs/applicants tables + columns; `students.parent_id` FK→`users.id` + `students_handshake_code_unique`; governance columns on users ONLY; the six named pgEnum member sets; `subscriptions.user_id` + offline payment fields + partial unique index; `evaluations` evaluated_id/evaluator_id FKs; `recitation_session_id_unique`; reports column set WITHOUT `teacher_id`; `surah_juz_ref` at 144 members; ABSENCE of any assignment/allocation table (B.10) — one PASS/FAIL line per row, zero writes, safe against prod.
  - [ ] 2.13.QL **Quality Loop:** sub-loop on the file (exit 0).
  - [ ] 2.13.TE **Test Engineering:** runner self-validation — all-PASS on the dev DB; FAIL on a planted wrong expectation (then removed).
  - [ ] 2.13.SEC **Security & Tenancy Audit:** read-only; no secret/env in output lines.
  - [ ] 2.13.SR **Semantic Review:** row list mirrors the research-08a/08b mapping tables; no schema-code involvement.
  - [ ] 2.13.IV **Instruction Verification:** root `AGENTS.md`.
  - _Requirements: REQ-010_

### 2.14 Bun-native load harness + EXPLAIN/index probes + N+1 oracle (plan C7 + C12 — §6)

- [ ] 2.14 [Ship `scripts/load/*` + `query-count-regression.test.ts` + the four verified FK indexes]
  - `scripts/load/` (Bun runtime, ZERO new heavyweight dependencies): `load-test.ts` (HTTP virtual-user driver, default 100 concurrent over the hot reads — directory browse, session lists, notification inbox; p50/p95/p99 + rps into a stamped, redacted JSON artifact), `ws-soak.ts` (100+ authenticated sockets for a bounded window; zero unexplained drops beyond `WS_MISSED_PONG_LIMIT = 2` at `backend/ws/notification-ws-server-constants.ts:11`; caps at `backend/lib/env.ts:405-408`), `matching-latency.ts` (100+ seeded teachers via the `scripts/qa-directory-fixtures.ts` fixture pattern; recorded duration with a generous CI multiple — REQ-008 AC-6), `probe-explain-analyze.ts` (`EXPLAIN (ANALYZE, BUFFERS)` over the critical query set incl. the escrow balance read; FAIL on driving-table Seq Scans — AC-2), `probe-indexes.ts` (true-coverage FK audit: static `references()` vs `index()` diff + live `pg_indexes` probe counting shared-PK children (`teacher.id`/`students.id`/`parents.id`/`admin.id`/`applicants.id` — there is NO `teacher.user_id` column, `backend/db/schema/teachers/teacher.ts:22-24`), composite-PK leading columns (`student_subscriptions.student_id`, `backend/db/schema/billing/student-subscriptions.ts:32`), and unique-constraint backing indexes (`wallet.teacher_id` via `wallet_teacher_id_unique`) as covered; the audit FAILs on any FK column without coverage — AC-4).
  - The four VERIFIED unindexed FK columns each gain a Drizzle `index()` shipped via **`bun run db push`** (the plan's plain schema changes): `broadcasts.sent_by_id`/`stopped_by_id` (`backend/db/schema/notifications/broadcasts.ts:45,49`), `subscription_purchase_idempotency.subscription_id` (`backend/db/schema/billing/subscription-purchase-idempotency.ts:32`), `session_request_idempotency.session_id` (`backend/db/schema/classes/session-request-idempotency.ts:32`).
  - `backend/graphql/test/query-count-regression.test.ts`: test-mode Drizzle query-count harness asserting constant SQL statements per GraphQL operation as page size grows (flat-projection kept; DataLoader retrofit waived — D6) — AC-3. Retire the dangling `test:simulate` package script (`package.json:40` → empty `test/simulate/`) — the harness supersedes it (D8).
  - [ ] 2.14.QL **Quality Loop:** sub-loop on every new/modified file (exit 0).
  - [ ] 2.14.TE **Test Engineering:** run the query-count test via `bun run test:graphql backend/graphql/test/query-count-regression.test.ts`; run a scaled dev load + soak + matching-latency pass and record the numbers into `outcome/` (the AC-1 dev baseline; production-scale runs are task 4.2 drill items per D3); pagination pins for 6.7 recorded from `teacher-matching.query.ts:50-51` etc.
  - [ ] 2.14.SEC **Security & Tenancy Audit:** drivers target explicitly-passed `--url` servers only; artifacts contain latency numbers only (D7 redaction); no new dependencies.
  - [ ] 2.14.SR **Semantic Review:** indexes land via `bun run db push` (NOT the custom-SQL lane); the coverage oracle is structural (no phantom columns — the shared-PK family counts as covered); thresholds are recorded numbers, not brittle CI gates (except the Seq-Scan FAIL).
  - [ ] 2.14.IV **Instruction Verification:** `backend/db/schema/AGENTS.md` (push policy) + `frontend/graphql/AGENTS.md` (query-count test layer) + instructions.
  - _Requirements: REQ-008_

### 2.15 `verify-cron.ts` live-envelope probe (plan C6 — REQ-012 AC-2/AC-3)

- [ ] 2.15 [Complete `scripts/launch/verify-cron.ts`]
  - GET each armed cron route (`app/api/cron/{sweep-sessions,sweep-inactive-teachers,expire-subscriptions,reconcile-paymob-payments}`) with the production bearer (read from the environment — never argv, never the report) and record the response envelopes (`{cancelled, refunded}`, `{offlined}`, expiry counts) as evidence rows for the 2.1.2/3.1.2/5.3.3 sweep mechanics; verify `NOTIFICATION_FANOUT_TRANSPORT` resolves to the Redis bus when `REDIS_URL` is set and probe the sidecar healthcheck (`scripts/start-notification-ws.ts`).
  - [ ] 2.15.QL **Quality Loop:** sub-loop on the file (exit 0).
  - [ ] 2.15.TE **Test Engineering:** runner self-validation — 404/401 fail-closed envelope on a wrong bearer (the existing route gates), PASS lines with the dev bearer.
  - [ ] 2.15.SEC **Security & Tenancy Audit:** bearer handling per plan §10; no secret ever reaches an output line.
  - [ ] 2.15.SR **Semantic Review:** evidence rows carry envelopes only — no env values.
  - [ ] 2.15.IV **Instruction Verification:** root `AGENTS.md`.
  - _Requirements: REQ-012_

---

## Phase 3: Reconciliation & Evidence Transcription (gate execution + checklist edits)

### 3.1 Execute the gate stages s1–s8 (§1–§8 suites + probes)

- [ ] 3.1 [Run `bun run scripts/launch/launch-gate.ts` through s1–s8 and capture per-row evidence]
  - Each stage invokes its mapped suites through canonical runners and records `{rowId, modality, command, exitStatus, evidenceRef, timestamp}`; a failing row halts the stage with rowId + exit code — fix and resume (`STAGES.indexOf`, passed stages never re-run). Re-spot-check every citation before transcribing a ✅ (specs §8 assumption (c)).
  - Evidence spine per section (run-and-record, never rebuilt): s2 — `session-lifecycle.service.test.ts` (booking lanes `:431-539`, deadline `:1118-1141`, dual confirmation `:2504-2631`, sweeper `:2799-3334`, REQ-043 chaos ×4 `testOnRealPostgres` `:2326-2422`), enforcement 5×5 `:164-193`, the §2 journeys incl. `financial-safety-verification.journey.test.ts:384-754`; 2.1.2–2.1.5 recorded as simulated per the checklist's own "or simulate" wording (sweeper legs + cron route gates, REQ-004 AC-5); s3 — inactivity suites + cron; s5 — consumes `docs/specs/state-machine-invariants.md` as row source, INV-B6 via the EXISTING `frontend/graphql/test/subscription-admin/subscription-admin.test.ts` (D7b); s7 — `scripts/ops/backup-restore.integration.test.ts` + `restore-verify.test.ts` re-runs, `VERDICT` parsed (`restore-verify.ts:213`); MANUAL-DRILL rows legitimately stay ☐ until Phase 4 files evidence (never auto-passed).
  - `scripts/escrow-e2e/` is NEVER cited as §2 evidence (D11); §4's beyond-envelope rows (lockout, distributed limiter, depth/complexity, CA-verified TLS) are dispositioned ☐ WHY + ledger pointer (D5/D14/D15) — never silently passed (REQ-006 AC-7).
  - [ ] 3.1.QL **Quality Loop:** sub-loop on any file touched by fixes (exit 0).
  - [ ] 3.1.TE **Test Engineering:** this run IS the TE — the per-stage captured logs (via `run-test.ts` log capture) are the `evidenceRef`s; all §1–§8 rows end ✅ or ☐ WHY with owner.
  - [ ] 3.1.SEC **Security & Tenancy Audit:** waiver rows all carry named owners; no row auto-passed.
  - [ ] 3.1.SR **Semantic Review:** stage→row counts reconcile against the 1.6 dry-run inventory.
  - [ ] 3.1.IV **Instruction Verification:** root `AGENTS.md` (runner commands).
  - _Requirements: REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010_

### 3.2 As-built re-wording + status flips in `docs/planning/PRODUCTION_READINESS.md`

- [ ] 3.2 [Apply the REQ-002 re-wording map and flip row statuses — design §14 protocol]
  - **Row-edit protocol:** edit the Status column and wording ONLY; the four-column row structure is preserved (REQ-013 AC-4); a row flips ONLY after its owning stage is green in 3.1 — the gate's per-row report is the edit ticket. Status format: `✅ <task-ref> (<evidence refs — test files, schema refs, command>)` (exemplars `:243`/`:328`); waivers keep `☐` + `WHY: <owner/scope>` (`:245`). Hard rule: "only tick boxes whose evidence actually executed".
  - **Re-wording map (REQ-002 AC-1..15, each with code pointers):** 2.2.2/2.2.3 → guarded request-time lane debit + `fee_held` + `held_balance_lane` provenance + same-lane refund once + consume-once; 2.5.2/2.5.3 → debit at request / approve settles / reject restores additively; 2.3.5/5.4.8 → `amount > 0` strictly positive; 5.3.1 → only `balance_trial` NOT NULL, others CHECK-bounded; 3.1.1/3.2.1/3.2.2 → `recordMyActivity` heartbeat + per-request context stamp, NO session-scoped realtime lane (sidecar push-only); 3.3.3 → directory-level exclusion is the gate, booking re-assertion waived (D1); 3.4.5 → ten notification types; 8.11 → per-submission minimum score of 80 across five rubric submissions; 8.13 → fee by session intent + the provisional `RE_EVALUATION_FEE = "100.00"` routed to the Product Owner as a sign-off input; 1.2.1/1.2.2 → immutable except documented guarded transitions; 1.1.1 → app-layer (corpus-proven) + DB-layer (new trigger) distinguished; 2.3.1/2.5.4 → GraphQL error-code vocabulary + the 2.9 wire pin; 4.2.4 → shipped cookie posture (D12); 5.3.3 → stale deferral flipped to ✅ citing `subscription-expiry.service.ts` + `subscription-expiry.service.test.ts:222-409` + `backend/db/test/logic/billing/subscription-expiry.repository.test.ts` + `test/workflows/billing/subscription-expiry.journey.test.ts` + the 2.11 journey; §9 `:365` → `bun run validate:mermaid` (`scripts/validation/validate-mermaid.ts`, `package.json:73`); vocabulary → role table `teacher` singular, `students.parent_id` → `users.id`, seven parent-portal read queries.
  - **Companion doc syncs (REQ-013 AC-1):** `docs/parents/monitoring-portal.md:248,250,268` five→seven read queries; `docs/sessions/session-lifecycle.md:82-83` unconsumed-gate consumer claim corrected (real enforcement `session-report.service.ts:262-274`, REQ-007 AC-3); the 5.3.3 expiry-surface note.
  - [ ] 3.2.QL **Quality Loop:** n/a for markdown (record either way, exemplar 5.1 precedent); sub-loop on any code file forced into the fix.
  - [ ] 3.2.TE **Test Engineering:** grep-verify no false-as-written claim survives (the fifteen re-worded phrasings) and every ✅ resolves to an executed command + artifact; capture the greps in the outcome file.
  - [ ] 3.2.SEC **Security & Tenancy Audit:** no row softened into vagueness — each states the shipped guarantee with pointers.
  - [ ] 3.2.SR **Semantic Review:** zero silent passes; every ☐ WHY carries owner + signatory placeholder.
  - [ ] 3.2.IV **Instruction Verification:** checklist's own row formats (`:243`, `:245`, `:328`); root AGENTS.md no-summary-file rule (the §9 table IS the record).
  - _Requirements: REQ-002, REQ-007, REQ-011, REQ-013_

### 3.3 s9 harness criteria: tsgo + Mermaid validation + ticket-state audit

- [ ] 3.3 [Run the machine-checkable final-launch criteria]
  - `bun tsgo` (zero errors) and `bun run validate:mermaid` → `scripts/validation/validate-mermaid.ts` (the corrected `:365` command) — recorded as s9 criteria evidence; ticket-state audit: grep `TICKETS.md`/`MILESTONE_PLAN.md` for each sibling M4 ticket's state — every unfinished sibling (student journey D4, load D3, state-machine wave) is either landed by its owner or explicitly waived-with-sign-off inside this gate, never silently passed (specs §0 precondition honesty).
  - [ ] 3.3.QL **Quality Loop:** n/a (execution task).
  - [ ] 3.3.TE **Test Engineering:** capture both command outputs + the ticket-audit table into the outcome file (11 of the 12 final criteria are harness-checkable; "All 5 sign-offs obtained" is irreducibly human — task 4.5).
  - [ ] 3.3.SEC **Security & Tenancy Audit:** n/a.
  - [ ] 3.3.SR **Semantic Review:** no sibling silently passed.
  - [ ] 3.3.IV **Instruction Verification:** root `AGENTS.md`.
  - _Requirements: REQ-011_

---

## Phase 4: Drills, Report & Sign-Off

### 4.1 DR cold-operator drill + evidence filing (rows 7.1–7.7)

- [ ] 4.1 [Execute ONE cold-operator drill per the runbook's quarterly procedure and file the evidence]
  - Procedure `docs/ops/disaster-recovery.md:247-252`: `bun run ops:db-backup` → `bun run ops:db-restore-verify` against a scratch target (the existing triple gate refuses production DSNs). File into `ai/plans/milestone_4/production_launch_checklist_execution/outcome/`: the per-step cold-operator timing table (total ≤ 2h vs RTO 4h — ≥50% headroom), the run's `restore-report-<stamp>.json` copy + manifest SHA-256 + final `VERDICT` line, and a friction log. Record operator-side timer evidence (systemctl list-timers/crontab satisfying `interval + runtime + jitter ≤ RPO 1h`, `:42`) as an ops sign-off line (D7); re-confirm the DR plan's own deferrals (Neon PITR D-001, scheduled automation D-002, off-site upload D-003) as sign-off lines (D9); cite the 7 read-only oracles (`scripts/ops/restore-oracles.ts`) for row 7.3. Partial drill evidence is NOT accepted — s7 rows flip only from the COMPLETE artifact set (plan §11).
  - [ ] 4.1.QL **Quality Loop:** n/a (execution task; sub-loop on any file forced into the fix).
  - [ ] 4.1.TE **Test Engineering:** the filed artifacts ARE the evidence — the launch report references their paths so the §7 checkboxes are reproducible (REQ-009 AC-6).
  - [ ] 4.1.SEC **Security & Tenancy Audit:** scratch DBs only; no production DSN anywhere in the filed evidence.
  - [ ] 4.1.SR **Semantic Review:** RPO 1h / RTO 4h / ≤2h drill arithmetic recorded per `:37-43`.
  - [ ] 4.1.IV **Instruction Verification:** `docs/ops/disaster-recovery.md` procedure + root `AGENTS.md`.
  - _Requirements: REQ-009_

### 4.2 Load drill execution (rows 6.1–6.3)

- [ ] 4.2 [Record the scaled dev run + file the production-scale runs as launch-drill items or signed waivers]
  - The scaled dev-environment baseline (task 2.14's `load-test.ts` + `ws-soak.ts` + `matching-latency.ts` numbers) is recorded in the launch report as the automated evidence; the production-scale runs — 100+ concurrent users p95 < 500ms, 100+ teacher matching, 100+ connections for 1 hour — are executed against the production-candidate environment during launch week and recorded as LAUNCH-DRILL evidence rows, OR explicitly waived with sign-off (D3 — the sustained program is the 8-SP sibling's, `TICKETS.md:2911`).
  - [ ] 4.2.QL **Quality Loop:** n/a (execution task).
  - [ ] 4.2.TE **Test Engineering:** every recorded number carries its command + artifact path; a waiver row carries its named owner + signatory.
  - [ ] 4.2.SEC **Security & Tenancy Audit:** load artifacts contain latency numbers only (D7 redaction).
  - [ ] 4.2.SR **Semantic Review:** no brittle thresholds invented beyond the recorded Seq-Scan FAIL oracle.
  - [ ] 4.2.IV **Instruction Verification:** root `AGENTS.md`.
  - _Requirements: REQ-008_

### 4.3 Ops runbook — cron arming, scheduler & production posture (`docs/ops/launch-arming-runbook.md`)

- [ ] 4.3 [Author the launch-arming runbook and record the live arming evidence]
  - NEW `docs/ops/launch-arming-runbook.md` (indexed from the planning docs), extending the `docs/ops/disaster-recovery.md:87-125` scheduling stanzas: external scheduler arming for the four cron routes (`app/api/cron/{sweep-sessions,sweep-inactive-teachers,expire-subscriptions,reconcile-paymob-payments}`) with `CRON_EXECUTION_MODE=external` + `CRON_EXTERNAL_ENABLED=true` + `CRON_SECRET` bearer, ≤5-minute cadence; WS sidecar boot (`bun run scripts/start-notification-ws.ts`) as a launch checklist line; `NOTIFICATION_FANOUT_TRANSPORT` resolving to the Redis bus when `REDIS_URL` is set (a miss silently degrades multi-process fanout to in-process); production `DATABASE_URL` carrying `sslmode=require`; the users-delete-guard production-DB posture line (D17): the `prevent_users_delete` trigger is armed with `kottaby.users_delete_guard` unset and the `off` opt-out value is never set in any production connection string or environment; the backup-timer evidence line (REQ-009 AC-3); the D5 on-demand `ops:sweep-link-requests`/`ops:remind-link-requests` cadence bounding the re-request lockout window (REQ-007 AC-5 / REQ-012 AC-5); the no-forgot-password-endpoint note. Record the live `verify-cron.ts` envelopes (task 2.15) as the arming evidence rows.
  - [ ] 4.3.QL **Quality Loop:** n/a for markdown (record either way).
  - [ ] 4.3.TE **Test Engineering:** every runbook claim resolves to a probe/test/verified env var (`.env.example` line refs) — grep-verify and capture.
  - [ ] 4.3.SEC **Security & Tenancy Audit:** the runbook never prints secret values — names + verification commands only.
  - [ ] 4.3.SR **Semantic Review:** scheduler arming is environment-side (D7) — the runbook states the evidence requirement, it does not claim arming happened without the sign-off lines.
  - [ ] 4.3.IV **Instruction Verification:** docs style of `docs/ops/disaster-recovery.md`.
  - _Requirements: REQ-012, REQ-009_

### 4.4 Launch report emission via the gate (final re-run → `VERDICT`)

- [ ] 4.4 [Re-run the gate to completion with all drill evidence present and emit the final machine report]
  - With 4.1/4.2 evidence filed and 4.3 arming recorded, re-run `bun run scripts/launch/launch-gate.ts` end-to-end: MANUAL-DRILL/DOC-SIGNOFF rows now verify from their filed artifacts; the gate writes `docs/planning/launch-report-<UTC-stamp>.json` (per-row tuples for all 173 rows + `stages` + `waivers` + `generatedAt`) and prints `VERDICT: PASS|FAIL` — PASS iff zero FAIL rows and every waiver carries a signatory. Run `secrets-scan.ts` against the report file before commit (D7). The re-run also proves the reproducibility criterion: a second run against unchanged code reproduces the same per-row verdicts (specs §9 Acceptance Metrics).
  - [ ] 4.4.QL **Quality Loop:** sub-loop on any harness file touched by fixes (exit 0).
  - [ ] 4.4.TE **Test Engineering:** the report IS the TE artifact — assert every ✅ row's `evidenceRef` resolves to a captured log, probe output, or filed artifact (report-integrity metric).
  - [ ] 4.4.SEC **Security & Tenancy Audit:** redaction check on the committed report (the D7 allowlist).
  - [ ] 4.4.SR **Semantic Review:** VERDICT semantics match the Launch Gate rule (`PRODUCTION_READINESS.md:12`) — any FAIL or unsigned waiver blocks launch.
  - [ ] 4.4.IV **Instruction Verification:** root `AGENTS.md` (no agent-authored summary markdown — this JSON is a ticket-required artifact, research-10 rec (d)).
  - _Requirements: REQ-001, REQ-011_

### 4.5 §9 sign-off collection (HUMAN task — the gate cannot self-sign)

- [ ] 4.5 [Collect the five human signatures — list exactly what to fill and where]
  - In `docs/planning/PRODUCTION_READINESS.md` §9, the named humans fill: the **five signature rows** (`:346-352`) — Engineering Manager, Dev 1 (Student & Parent), Dev 2 (Teacher Lifecycle), Dev 3 (Matching & Admin), Product Owner (Name/Signature/Date each); the **12 Final Launch Criteria checkboxes** (`:356-367`) — each ticked only against the 4.4 report + filed drill evidence; and the **🚀 Launch Approved line** (`:369`) with the approver + date. Interim pricing (session fee "25.00" EGP; provisional `RE_EVALUATION_FEE = "100.00"`) is explicitly routed to the Product Owner as a sign-off input (REQ-002 AC-8). The §9 table IS the sign-off record — no separate agent-authored summary markdown.
  - [ ] 4.5.QL **Quality Loop:** n/a (human/doc task).
  - [ ] 4.5.TE **Test Engineering:** verify the signature rows + criteria + Launch Approved line are filled; the harness checks ONLY evidence existence for the human rows — never auto-pass (REQ-001 AC-5).
  - [ ] 4.5.SEC **Security & Tenancy Audit:** n/a.
  - [ ] 4.5.SR **Semantic Review:** no signature transcribed by an agent; unsigned waiver rows remain launch-blocking.
  - [ ] 4.5.IV **Instruction Verification:** checklist's own §9 structure (four-column preservation rule).
  - _Requirements: REQ-011_

---

## Phase 5: Final Gate & Knowledge Propagation

### 5.1 Final quality gate, deferred-items enforcement & baseline comparison

- [ ] 5.1 [Run the full verification battery + ledger enforcement]
  - `bun quality-gate` — all stages green (tsgo → oxlint → biome → lint → duplicates). Ledger enforcement: `grep -cE '^\s*\|.*(❌|⚠️)' ai/plans/milestone_4/production_launch_checklist_execution/deferred-items.md` = 0 — every D1–D17 row is a ✅ resolved-pointer carrying its disposition target + owner (the deferred-by-design semantics; the launch-blocking waiver question is enforced by 4.4's `computeVerdict`, not by ❌/⚠️ rows). Baseline comparison: current `bun tsgo` / `bun biome:check` / lint counts vs `/tmp/baseline-*.txt` — document any new error introduced (target: none). Anti-pattern sweep over the delivered diff: no `Translation.` enum, no two-arg `getTranslations`, no `next-intl`/`shared/messages/`, no `@/frontend/utils/logger`, no `env-config-keys.ts` references (real mechanism: `backend/lib/env.ts` + `resetEnvironmentCache()`), no raw `bun test <single-file>` prescriptions, no UI/bottom-nav, no `jscpd:ignore`; DB tests use `runInRollback` + `tx`; journeys use committed fixtures.
  - REQ traceability audit (the spec's own check): `for r in $(grep -oE 'REQ-[0-9]+' specs.md | sort -u); do grep -q "$r" tasks.md || echo MISSING: $r; done` — zero output.
  - [ ] 5.1.QL **Quality Loop:** any file fixed during this gate re-runs its own sub-loop (exit 0).
  - [ ] 5.1.TE **Test Engineering:** capture every suite's green summary + the ledger/baseline/traceability outputs into `outcome/5.1-final-gate-outcome.md`.
  - [ ] 5.1.SEC **Security & Tenancy Audit:** re-confirm the §4 BOLA/BOPLA/BFLA postures one final time against the diff.
  - [ ] 5.1.SR **Semantic Review:** the semantic checklist over the whole diff (atomicity, env registration, dead code, cross-layer, enums, ledger).
  - [ ] 5.1.IV **Instruction Verification:** re-run sub-loop discovery on the final file list; confirm all listed rule files were honored.
  - _Requirements: REQ-013, REQ-000_

### 5.2 Knowledge propagation & documentation

- [ ] 5.2 [Synthesize the durable learnings into the canonical docs + the commands reference]
  - Read ALL files in `ai/plans/milestone_4/production_launch_checklist_execution/outcome/`; create the canonical reference doc at **`docs/quality/launch-gate.md`** (kebab-case; structure Why → Pattern → Rules → Anti-patterns → Rollout Summary → Related Documents). Subdir justification (verified): `docs/quality/` exists and already holds the gate/CI canon (`ci-pipeline.md`, `linting-rules.md`, `unused-code-cleanup.md`), and the template's domain-to-docs mapping sends "Quality gates / CI → `docs/quality/`" — `scripts/launch/launch-gate.ts` is the `quality-gate` sibling; ops-specific knowledge is NOT duplicated here (it lives in `docs/ops/disaster-recovery.md` + `docs/ops/launch-arming-runbook.md`).
  - Commands documentation (REQ-013 AC-2) — the sanctioned AGENTS.md edits of this plan are exactly TWO, both additive Layout/commands documentation with zero rule rewrites and zero `.agents/instructions/*` edits: (1) root `AGENTS.md` — ONE `scripts/launch/` line in the Essential Commands block (plan C15), mirroring how `quality-gate` and `ops:*` are documented today; (2) `frontend/graphql/test/AGENTS.md` — a Layout entry for the new `billing/` sub-directory (that file's rule 4 at `:36`, executed in task 2.9). NO `backend/db/test/logic/AGENTS.md` edit is needed: its Layout already documents the `shared/` sub-directory at `:15` that task 2.1/2.3/2.12 create. Do NOT touch any other AGENTS.md or `.agents/instructions/*`.
  - [ ] 5.2.QL **Quality Loop:** sub-loop on any created/modified file (exit 0).
  - [ ] 5.2.TE **Test Engineering:** n/a (documentation — record the doc grep-verifications from 3.2.TE/4.3.TE as the evidence).
  - [ ] 5.2.SEC **Security & Tenancy Audit:** docs must not disclose internal log formats/ids beyond what production already carries.
  - [ ] 5.2.SR **Semantic Review:** no summary/markdown files created outside the sanctioned docs + outcome locations.
  - [ ] 5.2.IV **Instruction Verification:** confirm the rule-files content policy was honored (exactly the two sanctioned AGENTS.md edits: the root Essential Commands line + the `frontend/graphql/test/AGENTS.md` Layout entry — both additive, per plan C15 and task 2.9).
  - _Requirements: REQ-013_

### 5.3 Outcome synthesis & per-section evidence matrices

- [ ] 5.3 [Write the per-section evidence matrices so sign-off is reproducible]
  - Write `outcome/` evidence matrices mirroring the research mapping tables: one per checklist section (§1–§9) — rowId → modality → command → evidenceRef → disposition (✅/☐ WHY + owner) — so a future auditor reproduces every verdict from the files alone; final outcome file consolidates carry-overs. The `deferred-items.md` ends resolved-pointer only with D1–D17 each closed or carrying its named owner (REQ-013 AC-3).
  - [ ] 5.3.QL **Quality Loop:** n/a (outcome documentation).
  - [ ] 5.3.TE **Test Engineering:** matrices reconcile 1:1 with the 4.4 launch report rows (173/173).
  - [ ] 5.3.SEC **Security & Tenancy Audit:** matrices carry repo-relative evidence paths only.
  - [ ] 5.3.SR **Semantic Review:** zero rows without a disposition; waivers match the ledger's waiver section.
  - [ ] 5.3.IV **Instruction Verification:** outcome-file conventions of this plan directory.
  - _Requirements: REQ-013_

---

**Task Sequencing (dependency graph):** 0.1 → 0.2 (plan-review gate — already executed this session) → 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 (harness self-verification) → Phase 2 closers (2.1 FIRST — the trigger unblocks 2.2's hard-delete probe leg; 2.5's sidecar + 2.11's expiry journeys before their citing rows flip; 2.14 before any s6 stage run; remaining closers are independent and may interleave) → 3.1 (stages green) → 3.2 (flips gated on 3.1) → 3.3 → 4.1 → 4.2 → 4.3 → 4.4 (final report) → 4.5 (human sign-off) → 5.1 → 5.2 → 5.3. Foundation-first with lifecycle isolation: each phase fully completes before the next begins; every created/modified file passes its per-file sub-loop before use elsewhere; every task writes its outcome file BEFORE the next task starts.
