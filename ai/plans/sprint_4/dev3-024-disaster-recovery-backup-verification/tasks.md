# Tasks: DEV3-024 — Disaster Recovery & Backup Verification

> **Plan directory:** `ai/plans/sprint_4/dev3-024-disaster-recovery-backup-verification/`
> **Specs:** `specs.md` (REQ-001..REQ-083, J1/J2, JR-01..JR-08) · **Design:** `plan.md` (D1–D12, V1–V10 check registry)
> **Scope profile (binding):** This is an **operations/tooling-only ticket** — `scripts/backup/`, `shared/locale/disasterRecovery`, `test/workflows/disaster-recovery/`, `docs/disaster-recovery/`. It has **zero frontend surface, zero GraphQL surface, zero schema/migration/enum changes** (REQ-043/060/061). Therefore: **Phase 1 collapses to tooling-types + i18n + zero-drift baseline capture**; **Phase 3 covers CLI entry points (not GraphQL resolvers)**; **Phase 4 contains NO UI tasks — it is replaced by the mandatory empty-diff verification gates**; **NO `.BF`/`.BS` agent-browser loops exist in this plan** (there is no UI to drive or screenshot — deferring them would be padding, fabricating them would be false work; agent-browser loops are explicitly recorded as N/A-to-ticket per specs §2.6/plan §5).

---

## Non-Negotiable Execution Protocol (applies to EVERY task)

1. **Pre-Execution outcome read:** Before starting task `X.Y`, read all prior `outcome/<task-id>-outcome.md` files in this plan directory (most importantly `outcome/0-baseline-outcome.md` and `outcome/plan-review-R1.md`).
2. **Post-Edit verification:** Every created/modified file MUST pass `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0) before its task checkbox flips.
3. **Test execution:** DB-touching tests run via `bun run scripts/run-test/run-test.ts <test-path>`; pure unit tests via `bun test <path>`; journeys via the run-test runner AND `bun test test/workflows` for the full tier.
4. **Semantic review self-check:** Before closing any task, self-review against the semantic checklist: atomicity, env-config registration (no free-floating `process.env` reads), zero dead code, no cross-layer imports (`scripts/` never imports `frontend/**` or `app/**`; verification imports schema objects only), enums as **value imports**, enum members never string literals, `logger` only (never `console.*`), no inline `--` comments inside `sql` templates.
5. **Outcome documentation:** Every task writes `outcome/<task-id>-outcome.md` recording: what was built, commands run + exit codes, evidence paths, any deviation, and ledger impact.
6. **Checkbox discipline:** `[ ]` → `[x]` only after ALL sub-subtasks of a task are green and the outcome file exists.

---

# Phase 0: Pre-Implementation Baseline

### Task 0.1 — Baseline Recording & Deferred-Items Ledger Initialization

- [ ] 0.1 Record error baseline and initialize the deferred-items ledger
  - Run and capture output of: `bun tsgo` (error count), `bun biome:check` (error count), `bun run scripts/lint-service.ts --json --id baseline`, and `git status --porcelain` / `git diff --name-only` (dirty-tree snapshot).
  - Create `ai/plans/sprint_4/dev3-024-disaster-recovery-backup-verification/deferred-items.md` from `.agents/spec-process-guide/templates/deferred-items-template.md`, pre-seeded with exactly two non-blocking forward items:
    - **D1** — Scheduled/automated backups + retention policy + WAL archiving / managed PITR (RPO ≤ 1h upgrade path) → owner: future platform-infrastructure ticket.
    - **D2** — Backup artifact encryption-at-rest automation (key management) → owner: future security-hardening ticket.
  - Capture a **structural no-drift baseline snapshot** for the zero-diff gates (REQ-043/060/061): `git diff` hash state for `backend/db/schema/**`, `backend/db/migration/**`, `backend/enum/**`, `backend/types/**`, `frontend/**`, `app/**`; run `bun run generate:gqlSchema && bun codegen` and store a checksum of `schema.graphql` and `frontend/graphql/generated/**` for later byte-identity comparison.
  - Write all baseline numbers and checksums to `outcome/0-baseline-outcome.md`.
  - _Requirements: REQ-001, REQ-043, REQ-060, REQ-061, REQ-083_

### Task 0.2 — Prerequisite Verification (Substrate Audit)

- [ ] 0.2 Verify verification-substrate dependencies exist as specified — never re-build them
  - Verify presence and API shape (read-only inspection, record findings):
    - `scripts/lib/destructiveDbGuard.ts` — confirm exported refusal API usable from new code (REQ-030).
    - `scripts/lib/process-lock.ts` — confirm existence for lock reuse (plan D7 "verify-before-use"); if ABSENT, record the fallback decision (`existsSync` + stale-timeout lockfile inside `lib/lock.ts`) in the outcome.
    - `backend/db/schema/index.ts` domain barrel exports — confirm Drizzle table objects are enumerable for the manifest inventory (plan §4.1 `lib/manifest.ts`).
    - `backend/db/migration/*.sql` — enumerate the append-only/immutability trigger names to pin `EXPECTED_INTEGRITY_TRIGGERS` (plan D12); record the exact list in the outcome.
    - `docs/graphql/api-gateway-and-routing.md` — extract the two sanctioned health-probe references the runbook will cite (REQ-017).
    - `docs/SQLITE_LOCAL_DEV.md` — confirm the `db/` gitignored-folder convention backing the `BACKUP_OUTPUT_DIR` default (plan D9) and confirm `.gitignore` already covers `db/`.
    - CI `tests-db` Postgres service (per `docs/quality/ci-pipeline.md`) — confirm `pg_dump`/`pg_restore` toolchain availability expectation; record the skip-with-signal gate strategy for environments lacking the binaries (REQ-053).
    - `shared/locale/AGENTS.md` — extract the 5-step namespace registration procedure for the `disasterRecovery` namespace (plan D10).
    - `.agents/` plan-review state — confirm `outcome/plan-review-R1.md` exists (Phase 1.5 gate) BEFORE any Phase 1+ task starts; if absent, run `@plan-review` first (REQ-083).
  - Write findings to `outcome/0.2-outcome.md`; any missing substrate becomes a ❌ deferred-items entry (never an inline patch).
  - _Requirements: REQ-001, REQ-030, REQ-042, REQ-053, REQ-083_

---

# Phase 1: Types, Manifest Contract, i18n Namespace & Env Registration

> **Scope note:** This phase contains **ZERO database schema work**. REQ-043 mandates an empty diff on `backend/db/schema/**`, `backend/db/migration/**`, `backend/enum/**`. The only "types" deliverables are the tooling-internal manifest contract (plan §2.2) and the compile-time i18n namespace. The Drizzle schema in `backend/db/schema/` is the sole structural ground truth and is consumed read-only.

### Task 1.1 — Manifest Tooling Contract Types

- [ ] 1.1 Implement `scripts/backup/lib/manifest.types.ts`
  - [Create `scripts/backup/lib/manifest.types.ts` per plan §2.2: `ManifestTableEntry` (`table`, `rowCount`, `contentHash: string | null`), `BackupManifest` (`manifestVersion: 1`, `databaseName`, `capturedAtUtc`, `pgDumpVersion`, `serverVersion`, `migrationJournalHash`, `tables`, `archiveSha256`) — all `readonly`, documented as the **single tooling-internal exception** to the `backend/types/` convention (no second layer consumes it); consumed canonical types stay imported from `@/backend/types`; zero table-shape redefinitions (structure derives from Drizzle objects, never duplicated).]
  - Applicable guidance: root `AGENTS.md`, `backend/types/AGENTS.md` (convention being deliberately bypassed — record why), `docs/specs/state-machine-invariants.md` (hash-critical set rationale).
  - _Requirements: REQ-003, REQ-011_
  - [ ] 1.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts scripts/backup/lib/manifest.types.ts --lifecycle duplicates` (exit 0)
  - [ ] 1.1.TE **Test Engineering**: Unit test — manifest type serialized/deserialized round-trips byte-identically (stable JSON key ordering, D4); `contentHash` nullability honored for non-critical tables only.
  - [ ] 1.1.SEC **Security & Tenancy Audit**: Static assertion that the type contains NO credential/host row-payload fields (REQ-031); BOPLA N/A (no input DTO) recorded.
  - [ ] 1.1.SR **Semantic Review**: No dead exports; no cross-layer imports; documentation comment cites specs REQ-003 exception sanction.
  - [ ] 1.1.IV **Instruction Verification**: Validate against root `AGENTS.md` + `backend/types/AGENTS.md` convention text.
  - Outcome: `outcome/1.1-outcome.md`

### Task 1.2 — `disasterRecovery` i18n Namespace (compile-time triple)

- [ ] 1.2 Create the `disasterRecovery` locale namespace with full `types`/`en`/`ar` parity
  - Files to create/modify:
    - `shared/locale/types/disasterRecovery/index.ts` (NEW) — `DisasterRecoveryLabels`: `toolchainMissing`, `toolchainVersionMismatch`, `guardRefusalManagedTarget`, `guardRefusalNonScratch`, `missingEnvConfig(key)`, `manifestMissing`, `manifestChecksumMismatch`, `artifactExists`, `verificationCheckFailed(checkId)`, `verificationPassed`, `unsupportedDialect`, `usageCreateBackup`, `usageRestoreVerify` — parameterized via typed function signatures, never `{var}` template strings.
    - `shared/locale/en/disasterRecovery/index.ts` (NEW) — English implementations.
    - `shared/locale/ar/disasterRecovery/index.ts` (NEW) — Arabic implementations (RTL-natural phrasing).
    - `shared/locale/types/message.ts` — `MessageSchema` entry.
    - `shared/locale/serverLegacy.ts` (or the current registration module per `shared/locale/AGENTS.md`) — namespace-path registration.
  - Consumed server-side only via `getServerTranslations(locale, "disasterRecovery")` from `@/shared/locale/server-graphql`; no `LocaleProvider`/layout registration.
  - Applicable guidance: `shared/locale/AGENTS.md`, `shared/AGENTS.md`.
  - _Requirements: REQ-051, REQ-002_
  - [ ] 1.2.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts` on each new/modified locale file (exit 0)
  - [ ] 1.2.TE **Test Engineering**: Parity is compile-gated — `bun tsgo` MUST fail if any key is missing in any leg (record green `tsgo` run as the test); interpolation functions reject wrong arity at compile time.
  - [ ] 1.2.SEC **Security & Tenancy Audit**: Messages contain NO credentials/paths-with-secrets; dynamic values are machine tokens (`key`, `checkId`) only (REQ-031/052).
  - [ ] 1.2.SR **Semantic Review**: No `next-intl` import; no `shared/messages/`; `getBackendTranslations` absent; Arabic strings non-empty and non-duplicate of English.
  - [ ] 1.2.IV **Instruction Verification**: Follow the exact 5-step registration from `shared/locale/AGENTS.md`; confirm `tsgo` MessageSchema gate passes.
  - Outcome: `outcome/1.2-outcome.md`

### Task 1.3 — Env-Config Key Registration (Fail-Closed)

- [ ] 1.3 Register backup tooling env keys through the project env-config convention
  - Modify the env-config registry module (locate per root `AGENTS.md` / env-config-keys convention): register `BACKUP_OUTPUT_DIR` (default `<repoRoot>/db/backups`, safe non-destructive default), `BACKUP_SCRATCH_PREFIX` (default `__drrestore_`), `BACKUP_KEEP_SCRATCH_DB` (default `false`), `BACKUP_DRILL_BUDGET_SECONDS` (default `300`); `DATABASE_URL` remains the existing restore-critical key.
  - Update test reset helpers so ALL newly resolved keys are invalidated (cache-invalidation completeness rule, REQ-045).
  - Empty-string acceptance for paths is FORBIDDEN.
  - _Requirements: REQ-045, REQ-012_
  - [ ] 1.3.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts <modified env-config files> --lifecycle duplicates` (exit 0)
  - [ ] 1.3.TE **Test Engineering**: Unit tests — missing key fails closed with typed error naming the key; empty-string path rejected; reset helper invalidates every newly registered key (assert by re-resolution after reset).
  - [ ] 1.3.SEC **Security & Tenancy Audit**: No key can silently default toward a destructive target; `DATABASE_URL` body never logged (name-only logging verified in later tasks).
  - [ ] 1.3.SR **Semantic Review**: Defaults are safe-and-non-destructive only; no inline `process.env` reads anywhere in `scripts/backup/**` (static grep assertion).
  - [ ] 1.3.IV **Instruction Verification**: Validate against env-config convention docs and root `AGENTS.md`.
  - Outcome: `outcome/1.3-outcome.md`

---

# Phase 2: Script Library Modules (Backup/Restore/Verify Core)

> **Journey tests are TEST-FIRST:** Tasks 2.1–2.3 (scaffold + J1 + J2) are written and RED before the library modules they exercise are implemented (tasks 2.4+). They are toolchain-gated (skip-with-signal when `pg_dump`/`pg_restore` absent) so the RED state fails on missing modules, not on missing binaries.

### Task 2.1 — Scaffold `test/workflows/` Tier (MANDATORY — Invariant 10)

- [ ] 2.1 Scaffold the cross-actor journey test layer (absent from the packaged tree)
  - Create `test/workflows/AGENTS.md` codifying: real services/tooling against the REAL test database; committed fixtures in `beforeAll`; tracked-ID hard-delete teardown in `afterAll`; `runInRollback` **FORBIDDEN** (tooling opens its own connections); side effects (email/SMS/push) spied or asserted absent; toolchain-gated skip-with-signal for external binaries; two-consecutive-green-runs determinism rule.
  - Create `test/workflows/helpers/` with:
    - `tracked-ids.ts` — fixture ID registry (`register(table, id)`, `hardDeleteAll(conn)` reverse-FK-order teardown).
    - `scratch-db.ts` — scratch DB create/drop utilities for tests (delegating to the lib once it exists; harness-level helpers only).
    - `toolchain.ts` — `pg_dump`/`pg_restore` presence probe + `describeLiveWhen`-style gate.
  - Create `test/workflows/disaster-recovery/helpers/fixtures.ts` — journey fixture builders for ALL seven dataset classes: student (all four balance lanes + trial lane + handshake code + parent link), parent, certified teacher (wallet + completed `earning` transaction), teacher applicant (`cooldownUntil` set, `verificationAttempts > 0`), super admin + `audit_logs` rows, in-flight session (`feeHeld = true`, `SessionStatus.Scheduled`, `confirmationDeadline` set), soft-deleted user with preserved session/report history. Fixtures composed through REAL service calls where a service exists and direct Drizzle inserts with canonical types where it does not; enums as value imports only.
  - _Requirements: REQ-070, REQ-071, REQ-074, Architectural Invariant 10_
  - [ ] 2.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts` on each new helper file (exit 0)
  - [ ] 2.1.TE **Test Engineering**: Helpers ship with a self-test (`test/workflows/helpers/tracked-ids.test.ts`) proving register→hard-delete round-trips cleanly against the real test DB (committed rows genuinely removed).
  - [ ] 2.1.SEC **Security & Tenancy Audit**: Fixture builders never accept external input; teardown deletes ONLY registered IDs (no wildcard deletes).
  - [ ] 2.1.SR **Semantic Review**: No `runInRollback` anywhere under `test/workflows/**` (static grep pinned); no `console.*`; logger only.
  - [ ] 2.1.IV **Instruction Verification**: Validate against Architectural Invariant 10 and `backend/db/AGENTS.md` test-layer rules.
  - Outcome: `outcome/2.1-outcome.md`

### Task 2.2 — Write Journey J1: Certified Round-Trip Drill — TEST-FIRST

- [ ] 2.2 Write `test/workflows/disaster-recovery/backup-restore-roundtrip.journey.test.ts` — TEST-FIRST (must be RED until the lib/CLI tasks complete)
  - Create `test/workflows/disaster-recovery/backup-restore-roundtrip.journey.test.ts` — one file for the J1 cross-actor workflow.
  - Provision the actor cast via the domain fixture helper from task 2.1 (all seven dataset classes, committed in `beforeAll`, tracked IDs registered for teardown) — real permission/tooling paths; NEVER monkey-patched.
  - Steps as sequential lib-entry calls (the thin CLIs hold zero logic; the lib call IS the real production path — plan D6): harness builds fixtures → **Operator** invokes backup → assert artifact + manifest exist, source table row counts UNCHANGED (read-only proof), logs contain zero secrets → **System** snapshot integrity: manifest validates against archive checksum, naming non-colliding, nothing written inside repo tree → **Harness** resolves restore target: guard approves scratch target; SECOND LEG asserts production-shaped target REFUSED (exit 3) → `pg_restore` into scratch (NEW database, never the app DB); probe insert proves identity/sequence health → full verification suite PASS → **Dataset observers**: student four lanes + trial lane + handshake + parent link identical; teacher wallet + transaction ledger content-hash identical; applicant cooldown/`verificationAttempts`/`status` verbatim; admin audit rows present + append-only triggers present; in-flight `feeHeld` session intact with identical `confirmationDeadline`; soft-deleted user + history preserved → re-verify same artifact: byte-identical PASS report (REQ-044) → measured drill wall-clock recorded against `BACKUP_DRILL_BUDGET_SECONDS` (REQ-016) → **Teardown**: scratch DB dropped, fixtures hard-deleted by tracked IDs, second full run passes identically.
  - Assert cross-actor visibility per plan §4.4 (who observes what after each step) AND denial path (guard refusal mid-journey).
  - Committed fixtures in `beforeAll` + tracked hard-delete in `afterAll` — NEVER `runInRollback`.
  - Side effects: assert NO notification/email/SMS dispatch path exists in this flow (spy modules and assert zero invocations).
  - Verify: `bun run scripts/run-test/run-test.ts test/workflows/disaster-recovery/backup-restore-roundtrip.journey.test.ts` green, then `bun test test/workflows` (task 5.x owns the two-consecutive-runs gate).
  - _Requirements: REQ-070, REQ-071, REQ-073, JR-01, JR-02, JR-03, JR-04, JR-05, JR-07, JR-08_

### Task 2.3 — Write Journey J2: Hostile / Failure Legs — TEST-FIRST

- [ ] 2.3 Write `test/workflows/disaster-recovery/failure-legs.journey.test.ts` — TEST-FIRST
  - Create `test/workflows/disaster-recovery/failure-legs.journey.test.ts` — one file for the J2 hostile workflow.
  - Provision a minimal fixture cast via the domain helper (one student suffices for tamper-proofing) — committed in `beforeAll`, hard-deleted in `afterAll`.
  - Sequential hostile legs: harness tampers manifest (flip exactly one `rowCount`) → verification FAIL with exit 5 naming exactly that table (JR-07) → harness presents corrupted archive (truncated bytes) → typed toolchain/verification failure, never a partial-PASS → **Operator** attempts restore into a production-shaped target URL (managed-host markers / `NODE_ENV=production` shape) → guard refusal exit 3 with localized `guardRefusalManagedTarget` message and ZERO bytes written to the target (assert by connection-level introspection that no scratch was created) → **Operator** runs restore-verify with a required env-config key unset → closed failure naming the missing key → **Operator** passes garbage CLI flags → exit 2 with usage surface.
  - Assert each exit-code tier per the REQ-050 taxonomy; assert the FAIL report contains check id + expected/actual counts/hashes and NO row payloads (REQ-052).
  - Committed fixtures in `beforeAll` + tracked hard-delete in `afterAll` — NEVER `runInRollback`; scratch artifacts quarantined per report.
  - Verify: `bun run scripts/run-test/run-test.ts test/workflows/disaster-recovery/failure-legs.journey.test.ts` green, then `bun test test/workflows`.
  - _Requirements: REQ-072, REQ-050, REQ-030, REQ-052, JR-06, JR-07_

### Task 2.4 — Exit-Code Taxonomy Module

- [ ] 2.4 Implement `scripts/backup/lib/exit-codes.ts`
  - Files: `scripts/backup/lib/exit-codes.ts` (NEW) — frozen `BackupExitCode` union (`0 | 2 | 3 | 4 | 5 | 6`) + `failWith(code, localizedMessageKey, context): never` routing EVERY failure through `logger` (never `console.*`, never raw `throw` from CLIs) with correlation id for exit-6 masked internal failures; `succeed()` helper for exit 0.
  - Applicable: root `AGENTS.md`; `docs/quality/ci-pipeline.md` (CI-consumable exits).
  - _Requirements: REQ-050, REQ-051_
  - [ ] 2.4.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts scripts/backup/lib/exit-codes.ts --lifecycle duplicates` (exit 0)
  - [ ] 2.4.TE **Test Engineering**: 4-Tier — Tier 1: every branch of `failWith`/`succeed` (each code maps correctly); Tier 2: boundary (unknown code input rejected at compile time; runtime assertion path); Tier 3: chaos (logger failure path does not produce a silent zero exit); Tier 4: security (context redaction — poisoned context containing `DATABASE_URL`-shaped strings never reaches log output, REQ-031).
  - [ ] 2.4.SEC **Security & Tenancy Audit**: Redaction-discipline parity with `redactLogContext` conventions; messages resolve via `getServerTranslations(locale, "disasterRecovery")` only.
  - [ ] 2.4.SR **Semantic Review**: `failWith` return type is `never`; no mutable module state; no dead branches.
  - [ ] 2.4.IV **Instruction Verification**: Validate against root `AGENTS.md` logging + i18n rules.
  - Outcome: `outcome/2.4-outcome.md`

### Task 2.5 — CLI Argument Parser (Closed Flag Union)

- [ ] 2.5 Implement `scripts/backup/lib/args.ts`
  - Files: `scripts/backup/lib/args.ts` (NEW) — `parseCreateBackupArgs(argv)` (`--out <dir>` only) and `parseRestoreVerifyArgs(argv)` (`--artifact <path>` required, `--keep-scratch` optional); unknown flag / missing required flag → usage error (exit 2) with localized usage text; field-by-field mapping into config — object spreads FORBIDDEN.
  - _Requirements: REQ-033, REQ-050, REQ-072_
  - [ ] 2.5.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts scripts/backup/lib/args.ts --lifecycle duplicates` (exit 0)
  - [ ] 2.5.TE **Test Engineering**: Tier 1 branch coverage over every accepted/rejected flag; Tier 2 boundary (empty argv, duplicate flags, `--artifact` without value, path with spaces); Tier 3 chaos (non-UTF8 arg, flag-like positional garbage); Tier 4 security (flags carrying shell metacharacters must round-trip as inert strings — they are never interpolated anywhere).
  - [ ] 2.5.SEC **Security & Tenancy Audit**: BOPLA — closed union proven by test asserting unknown keys are rejected BEFORE use; no `{ ...args }` spread anywhere (static grep pinned).
  - [ ] 2.5.SR **Semantic Review**: Parser is pure (no I/O); deterministic ordering of usage text.
  - [ ] 2.5.IV **Instruction Verification**: Root `AGENTS.md` + `docs/quality/ci-pipeline.md` injection-defense posture.
  - Outcome: `outcome/2.5-outcome.md`

### Task 2.6 — Config Resolution

- [ ] 2.6 Implement `scripts/backup/lib/config.ts`
  - Files: `scripts/backup/lib/config.ts` (NEW) — `resolveBackupConfig(flags)` / `resolveRestoreVerifyConfig(flags)` composing task-1.3 registered env keys with parsed flags; fail-closed on missing restore-critical values with the error NAMING the key; sqlite provider detection → typed `unsupportedDialect` refusal (REQ-020).
  - _Requirements: REQ-045, REQ-050, REQ-020, REQ-012_
  - [ ] 2.6.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts scripts/backup/lib/config.ts --lifecycle duplicates` (exit 0)
  - [ ] 2.6.TE **Test Engineering**: Tier 1 all resolution branches; Tier 2 boundary (missing key names itself; empty-string output dir rejected); Tier 3 chaos (circular/relative/out-of-root output path handling); Tier 4 security (config containing credentials never echoed into error messages).
  - [ ] 2.6.SEC **Security & Tenancy Audit**: No silent default toward a destructive target; connection strings never surfaced.
  - [ ] 2.6.SR **Semantic Review**: No inline `process.env` reads; reset-helper invalidation completeness cross-checked with task 1.3.
  - [ ] 2.6.IV **Instruction Verification**: Env-config registration convention docs.
  - Outcome: `outcome/2.6-outcome.md`

### Task 2.7 — Toolchain Probe

- [ ] 2.7 Implement `scripts/backup/lib/toolchain-probe.ts`
  - Files: `scripts/backup/lib/toolchain-probe.ts` (NEW) — `assertBackupToolchain(connection)`: `--version` probe of `pg_dump`/`pg_restore` via argv-array spawn; server major version query; major-version compatibility matrix; absence or mismatch → exit 4 closed path BEFORE any work (REQ-053).
  - _Requirements: REQ-053, REQ-050, REQ-034_
  - [ ] 2.7.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts scripts/backup/lib/toolchain-probe.ts --lifecycle duplicates` (exit 0)
  - [ ] 2.7.TE **Test Engineering**: Tier 1 branches (both binaries present/absent, version parse, mismatch matrix cells); Tier 2 boundary (major equal, minor skew tolerances); Tier 3 chaos (binary exists but errors on exec; unparseable version output); Tier 4 security (path injection in binary name impossible — closed constant names only). All spawn calls mocked in unit tests (mock adapters).
  - [ ] 2.7.SEC **Security & Tenancy Audit**: argv-array spawn only; binary names are compile-time constants (no env-controlled executable paths).
  - [ ] 2.7.SR **Semantic Review**: Fail-closed ordering: probe precedes any DB-writing or filesystem-writing action.
  - [ ] 2.7.IV **Instruction Verification**: `docs/quality/ci-pipeline.md` injection-defense posture.
  - Outcome: `outcome/2.7-outcome.md`

### Task 2.8 — Backup Lock

- [ ] 2.8 Implement `scripts/backup/lib/lock.ts`
  - Files: `scripts/backup/lib/lock.ts` (NEW) — `acquireBackupLock(sourceDbName)`: reuse `scripts/lib/process-lock.ts` if task-0.2 confirmed it exists (exact-API reuse); otherwise `existsSync`-guarded lockfile with stale-lock timeout sweep; lock name derived from source DB name (`backup:<dbName>`); release in `finally`; verify runs intentionally lock-free (REQ-042).
  - _Requirements: REQ-042, REQ-018_
  - [ ] 2.8.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts scripts/backup/lib/lock.ts --lifecycle duplicates` (exit 0)
  - [ ] 2.8.TE **Test Engineering**: Tier 1 acquire/release/reject-on-held branches; Tier 2 boundary (stale-lock timeout edge, same-name serialization, different-source parallel allowed); Tier 3 chaos (orphaned lockfile from killed process sweeped by stale timeout; lock dir unwritable → closed typed failure); Tier 4 security (lock name derived from vetted config, never from CLI strings).
  - [ ] 2.8.SEC **Security & Tenancy Audit**: Lockfile path confined to the configured scratch/lock area; no symlink-follow vulnerability via `wx`-style exclusive create.
  - [ ] 2.8.SR **Semantic Review**: Release guaranteed on ALL exit paths (try/finally audit); no module-level mutable accumulators persisting across runs (process-per-run discipline, REQ-018).
  - [ ] 2.8.IV **Instruction Verification**: Root `AGENTS.md`; verify-before-use record from outcome 0.2.
  - Outcome: `outcome/2.8-outcome.md`

### Task 2.9 — Snapshot Session

- [ ] 2.9 Implement `scripts/backup/lib/snapshot.ts`
  - Files: `scripts/backup/lib/snapshot.ts` (NEW) — `openExportSnapshot(pgClient)`: `BEGIN; SET TRANSACTION ISOLATION LEVEL REPEATABLE READ; SELECT pg_export_snapshot()` returning `{ client, snapshotId, openedAtUtc }`; `closeSnapshot()` COMMIT; the transaction MUST outlive the dump (plan D2); structured error on snapshot-export failure (exit 6 masked internal).
  - _Requirements: REQ-040, REQ-034_
  - [ ] 2.9.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts scripts/backup/lib/snapshot.ts --lifecycle duplicates` (exit 0)
  - [ ] 2.9.TE **Test Engineering**: Tier 1 happy + failure branches; Tier 2 boundary (snapshot lifecycle ordering: manifest queries, then dump, then COMMIT); Tier 3 chaos (connection drop mid-snapshot → rollback-safe, no leaked transaction, lock still released by caller); Tier 4 security (read-only transaction asserts no writes attempted within snapshot session). Integration tier against real test DB via `bun run scripts/run-test/run-test.ts`.
  - [ ] 2.9.SEC **Security & Tenancy Audit**: Parameterized SQL only; snapshot id never logged in full beyond correlation-safe prefix; read-only session (source never mutated — REQ-020).
  - [ ] 2.9.SR **Semantic Review**: No `pg_advisory_lock` (plan §4.3 decision recorded); transaction lifecycle symmetric (open/close in one module).
  - [ ] 2.9.IV **Instruction Verification**: Root `AGENTS.md`; `docs/IDEMPOTENCY.md` tooling posture.
  - Outcome: `outcome/2.9-outcome.md`

### Task 2.10 — Manifest Builder

- [ ] 2.10 Implement `scripts/backup/lib/manifest.ts`
  - Files: `scripts/backup/lib/manifest.ts` (NEW) — Drizzle-object-derived `TABLE_INVENTORY` (every application table, physical PG names); frozen `CRITICAL_HASH_TABLES` set (`student_payments`, `teacher_transaction`, `wallet`, `audit_logs`, `subscriptions`, `students`, `applicants` per REQ-011) with a static non-vacuity assertion; `buildManifestBody(snapshotClient)`: per-table `rowCount` for ALL tables; `contentHash` for critical tables via canonical serialization (D4: PK-ordered rows, timestamps → epoch-ms UTC ISO, decimals → text form, fixed key order, rows joined `\n`, SHA-256); `migrationJournalHash` over `drizzle.__drizzle_migrations` (quoted identifiers); `finalizeManifest(body, archivePath)` adding `archiveSha256`.
  - _Requirements: REQ-011, REQ-003, REQ-031, REQ-044_
  - [ ] 2.10.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts scripts/backup/lib/manifest.ts --lifecycle duplicates` (exit 0)
  - [ ] 2.10.TE **Test Engineering**: Tier 1 every serialization branch (timestamp, decimal, null, text, boolean); Tier 2 boundary (empty table hash, single row, key-order stability); Tier 3 chaos (reordered columns in query result still hash identically; duplicate PK impossible — asserted); Tier 4 security (manifest content scan: no credential/host/row-payload keys — REQ-031 unit-locked). Determinism: same fixture state hashed twice → identical hash (pins REQ-044 at unit level).
  - [ ] 2.10.SEC **Security & Tenancy Audit**: Table names come exclusively from Drizzle schema objects (never CLI/env strings — REQ-033/034); no `--` comments in any `sql` template.
  - [ ] 2.10.SR **Semantic Review**: `CRITICAL_HASH_TABLES` is frozen and non-empty (static assertion); no duplicated table-shape definitions (inventory derives from schema barrel).
  - [ ] 2.10.IV **Instruction Verification**: `backend/db/schema/AGENTS.md` single-structural-source rule; root `AGENTS.md`.
  - Outcome: `outcome/2.10-outcome.md`

### Task 2.11 — Dump Runner

- [ ] 2.11 Implement `scripts/backup/lib/dump.ts`
  - Files: `scripts/backup/lib/dump.ts` (NEW) — `runPgDump({ bin, connectionUrl, snapshotId, archivePath })`: argv-array spawn (`--format=custom --snapshot=<id> --file=<tempPath>`); refuse if FINAL artifact name already `existsSync` (no clobber — REQ-012); temp-write-then-rename (partial dumps never adopt final names); byte-size + duration returned for the completion log; connection string passed via env to the child process, NEVER as a logged argument.
  - _Requirements: REQ-010, REQ-012, REQ-040, REQ-034, REQ-031_
  - [ ] 2.11.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts scripts/backup/lib/dump.ts --lifecycle duplicates` (exit 0)
  - [ ] 2.11.TE **Test Engineering**: Tier 1 branches (clobber refusal, temp→rename, non-zero pg_dump exit propagation); Tier 2 boundary (naming: `<dbname>-<UTC>-<shorthash>` collision-resistance assertion); Tier 3 chaos (disk-full mid-dump → no partial final artifact; killed child → temp cleanup); Tier 4 security (argv-only spawn — static test asserting no shell-string spawn in `scripts/backup/**`; connection string never present in argv — env-passing verified by mock-spawn inspection).
  - [ ] 2.11.SEC **Security & Tenancy Audit**: World-readable permissions explicitly NOT set (umask-default file creation, REQ-032); artifact path resolved within configured output root only.
  - [ ] 2.11.SR **Semantic Review**: Temp file naming collision-safe; error paths leave zero residue (REQ-012).
  - [ ] 2.11.IV **Instruction Verification**: `docs/quality/ci-pipeline.md` injection-defense; root `AGENTS.md`.
  - Outcome: `outcome/2.11-outcome.md`

### Task 2.12 — Restore-Target Guard

- [ ] 2.12 Implement `scripts/backup/lib/guard.ts`
  - Files: `scripts/backup/lib/guard.ts` (NEW) — `assertRestorableScratchTarget({ url, dbName })`: composes `scripts/lib/destructiveDbGuard.ts` refusal (managed/production-shaped hosts, `NODE_ENV=production` without explicit drill allowance) WITH the scratch-name rule (must match `<source>__drrestore_<utcStamp>` shape from `BACKUP_SCRATCH_PREFIX`); refusal → exit 3 with localized `guardRefusalManagedTarget` / `guardRefusalNonScratch` and ZERO bytes written; refuse if the target name matches ANY existing application database name.
  - _Requirements: REQ-030, REQ-013, REQ-050_
  - [ ] 2.12.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts scripts/backup/lib/guard.ts --lifecycle duplicates` (exit 0)
  - [ ] 2.12.TE **Test Engineering**: Tier 1 all refusal/approval branches; Tier 2 boundary (name-shape edge cases; prefix configurability); Tier 3 chaos (case variants of managed hosts, URL-embedded credentials attempts, application-DB-name collisions); Tier 4 security (the matrix of managed-host shapes — Neon/Supabase/RDS markers — each refused; NO flag/env/code path can bypass; static grep asserts no force-flag exists).
  - [ ] 2.12.SEC **Security & Tenancy Audit**: This module IS the security boundary — identity-agnostic target vetting (plan §3.3); refusal writes zero bytes (asserted in J2 leg 3).
  - [ ] 2.12.SR **Semantic Review**: Guard runs BEFORE any scratch creation or `pg_restore` (ordering assertion); no authorization shortcut paths.
  - [ ] 2.12.IV **Instruction Verification**: `docs/DATABASE_MIGRATIONS.md` destructive-policy lineage; root `AGENTS.md`.
  - Outcome: `outcome/2.12-outcome.md`

### Task 2.13 — Scratch Lifecycle & Restore Runner

- [ ] 2.13 Implement `scripts/backup/lib/restore.ts`
  - Files: `scripts/backup/lib/restore.ts` (NEW) — `createScratchDatabase(maintenanceUrl, name)` (name embeds timestamp + short suffix; SQL identifier via quoted-identifier handling, never string-concatenated values); `dropScratchDatabase(...)`; `runPgRestore({...})` argv-only; `probeIdentityAndSequences(scratch)`: probe insert + delete into a safe table (or setval verification from dump sequence state) proving identity/sequence health; scratch-collision retry-once then exit-6 path.
  - _Requirements: REQ-013, REQ-041, REQ-034_
  - [ ] 2.13.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts scripts/backup/lib/restore.ts --lifecycle duplicates` (exit 0)
  - [ ] 2.13.TE **Test Engineering**: Tier 1 create/restore/probe/drop branches; Tier 2 boundary (name collision regeneration; `--keep-scratch` retention); Tier 3 chaos (pg_restore failure → scratch dropped, exit non-zero, FAIL report names phase; probe failure path); Tier 4 security (argv-only; scratch name from server-side generator, never CLI). Integration probes against real test DB via `bun run scripts/run-test/run-test.ts`.
  - [ ] 2.13.SEC **Security & Tenancy Audit**: All-or-nothing (REQ-041): no path reports success on partial restore; probe writes confined to scratch DB only.
  - [ ] 2.13.SR **Semantic Review**: Teardown symmetric with creation; no retained connections after drop; deterministic behavior across re-runs (REQ-018).
  - [ ] 2.13.IV **Instruction Verification**: Root `AGENTS.md`; `docs/DATABASE_MIGRATIONS.md` (restore→forward-reconcile is REPORT-ONLY here).
  - Outcome: `outcome/2.13-outcome.md`

### Task 2.14 — Trigger Inventory Registry

- [ ] 2.14 Implement `scripts/backup/lib/trigger-inventory.ts`
  - Files: `scripts/backup/lib/trigger-inventory.ts` (NEW) — frozen `EXPECTED_INTEGRITY_TRIGGERS` constant pinned from the task-0.2 enumeration of `backend/db/migration/*.sql` (audit-immutability/append-only trigger set — plan D12).
  - Companion static-parity test: `scripts/backup/__tests__/trigger-inventory.parity.test.ts` asserting every registry member's name appears in the migration SQL files (registry ⊆ migration SQL), guarding silent drift.
  - _Requirements: REQ-014(3), REQ-043_
  - [ ] 2.14.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts` on both files (exit 0)
  - [ ] 2.14.TE **Test Engineering**: The parity test IS the Tier 1/2 suite; Tier 3 chaos (empty registry fails the test — non-vacuity); Tier 4 security N/A recorded.
  - [ ] 2.14.SEC **Security & Tenancy Audit**: Registry is a compile-time constant; no runtime parsing of SQL.
  - [ ] 2.14.SR **Semantic Review**: Constant frozen; rationale comment citing A.5/INV-W6/INV-PAY2 lineage.
  - [ ] 2.14.IV **Instruction Verification**: `docs/DATABASE_MIGRATIONS.md`; `backend/db/migration/` conventions.
  - Outcome: `outcome/2.14-outcome.md`

### Task 2.15 — Verification Suite (V1–V10 Check Registry)

- [ ] 2.15 Implement `scripts/backup/lib/verify.ts`
  - Files: `scripts/backup/lib/verify.ts` (NEW) — `VerificationCheck { id, phase, execute(conn, manifest) }` registry + runner aggregating `CheckResult[]`:
    - **V1 `TABLE_SET_PARITY`** — restored table set == manifest table set.
    - **V2 `ROW_COUNT_PARITY`** — every manifest `rowCount` matches live count.
    - **V3 `CONTENT_HASH_PARITY`** — every critical table re-hashes identically (reusing task-2.10 canonical serializer).
    - **V4 `FINANCIAL_INVARIANTS`** — all four student lanes + trial lane ≥ 0; `wallet.balance`/`totalEarning` ≥ 0; per-teacher `totalEarning == SUM(amount) WHERE type = TransactionType.Earning AND status = TransactionStatus.Completed`; `teacher_transaction.amount ≥ 0`; `student_payments.amount ≥ 0` (INV-W1/W2/W8, INV-PAY1, INV-B).
    - **V5 `IMMUTABILITY_TRIGGERS_PRESENT`** — `EXPECTED_INTEGRITY_TRIGGERS` all present in `pg_trigger` (INV-W6/INV-PAY2, A.5; task-2.14 registry).
    - **V6 `GOVERNANCE_PRESERVATION`** — soft-deleted users present (`isDeleted = true`); their sessions/reports/financials FK-reachable; governance flags preserved (INV-U1/U4/U5, A.7).
    - **V7 `FK_ORPHAN_SCAN`** — zero orphans across all declared FKs; nullable/`set null` links (`evaluations.sessionId`, `students.parentId`, `lessons.planId`, `progress.lessonId`, `studentPayments.subscriptionId`, `teacherTransaction.sessionId`) verified as NULL-consistent instead.
    - **V8 `DOMAIN_SPOT_INVARIANTS`** — `handshakeCode` unique (A.3); `recitation.sessionId` unique (C.5); applicant `cooldownUntil`/`verificationAttempts`/`status` content-preserved (INV-TV3, JR-03); in-flight holds (`feeHeld = true AND status IN (SessionStatus.Scheduled, SessionStatus.Started)`) present with identical `confirmationDeadline` (B.4, JR-05); `subscriptions` windows/status preserved (A.9).
    - **V9 `STRUCTURAL_FINGERPRINT`** — required indexes/constraints spot-present via catalog queries.
    - **V10 `MIGRATION_DRIFT_REPORT`** — REPORT-ONLY: `backend/drizzle/` migration folders newer than the restored journal listed as forward-reconciliation pointer (`bun db push` / `bun db migrate` per `docs/DATABASE_MIGRATIONS.md`); NEVER auto-applied.
  - All SQL parameterized; table inventory from Drizzle objects; enums as VALUE imports (`@/backend/enum/**`), members never string literals; `escapeLikeWildcards` recorded N/A (no LIKE surface).
  - _Requirements: REQ-014, REQ-040, REQ-044, REQ-052, REQ-033, REQ-034_
  - [ ] 2.15.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts scripts/backup/lib/verify.ts --lifecycle duplicates` (exit 0)
  - [ ] 2.15.TE **Test Engineering** (4-Tier, against the real test DB via seeded scratch states):
    - Tier 1: every check has a PASS branch test AND a divergence FAIL branch test (tamper one row per invariant family).
    - Tier 2 boundary: empty-database verification; single-row tables; nullable-link exemptions genuinely exercised (rows with NULL in each exempted FK).
    - Tier 3 chaos: missing trigger (drop one in scratch) → V5 names it; orphaned row injected → V7 names the FK; broken wallet equation → V4 names the teacher id (id only, no amounts in report payload beyond divergence signal).
    - Tier 4 security: FAIL payloads contain counts/hashes only — a poisoned dataset with PII-shaped values asserts zero PII leakage in any report field (REQ-052).
    - Execution: `bun run scripts/run-test/run-test.ts` for all DB-touching suites.
  - [ ] 2.15.SEC **Security & Tenancy Audit**: Parameterized SQL audit across all ten checks; no identifier interpolation from external strings; report redaction proven by Tier 4.
  - [ ] 2.15.SR **Semantic Review**: Check registry ordering deterministic (byte-identical PASS reports, REQ-044); enum value-import grep (`import type` on enums forbidden); zero dead checks.
  - [ ] 2.15.IV **Instruction Verification**: `docs/specs/state-machine-invariants.md` mapping table in code comments (each check cites its invariant IDs); root `AGENTS.md`.
  - Outcome: `outcome/2.15-outcome.md`

### Task 2.16 — Report Writer

- [ ] 2.16 Implement `scripts/backup/lib/report.ts`
  - Files: `scripts/backup/lib/report.ts` (NEW) — PASS/FAIL JSON report writer (`<artifact>.verify-report.json`): atomic temp-write-then-rename; deterministic key/entry ordering (byte-identical consecutive reports, REQ-044); content: per-check id + status + expected/actual counts-hashes, artifact path, scratch DB name, drill wall-clock duration vs `BACKUP_DRILL_BUDGET_SECONDS`, remediation pointer to runbook section; NO row payloads, NO stack traces on tier-5 failures (REQ-052); exit-6 correlation id only on masked internals.
  - _Requirements: REQ-052, REQ-044, REQ-016_
  - [ ] 2.16.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts scripts/backup/lib/report.ts --lifecycle duplicates` (exit 0)
  - [ ] 2.16.TE **Test Engineering**: Tier 1 PASS/FAIL serialization branches; Tier 2 boundary (empty check list rejected; single-byte-stable ordering); Tier 3 chaos (unwritable report dir → typed failure, no partial file); Tier 4 security (payload scan: no PII-shaped values ever serialized).
  - [ ] 2.16.SEC **Security & Tenancy Audit**: Report content discipline unit-locked (REQ-052); file confined to artifact directory.
  - [ ] 2.16.SR **Semantic Review**: Determinism proven by a double-write byte-comparison unit test; atomic rename on all paths.
  - [ ] 2.16.IV **Instruction Verification**: Root `AGENTS.md`.
  - Outcome: `outcome/2.16-outcome.md`

### Task 2.M — Mid-Point Review Gate (MANDATORY)

- [ ] 2.M Mid-Point Review: halt implementation; verify before proceeding to Phase 3
  - Re-run `bun tsgo` + `bun biome:check` — counts MUST equal task-0.1 baseline + 0 (locale namespace excepted as recorded).
  - Run every unit/integration suite created in Phase 2; all green via the sanctioned runners.
  - Static sweeps: `grep -rn "console\." scripts/backup/` → 0 hits; `grep -rn "process\.env" scripts/backup/lib/` → 0 hits outside config.ts; `grep -rn "import type" scripts/backup/lib/ | grep enum` → 0 hits; argv-only spawn scan → 0 string-spawns; `{ ...` spread scan into spawn/query construction → 0 hits.
  - Verify journeys J1/J2 are still RED (implementation incomplete at CLI level) or transitioning GREEN as libs landed — record actual state.
  - Verify zero-diff gates still hold on `backend/db/schema/**`, `backend/db/migration/**`, `backend/enum/**`, `frontend/**`, `app/**`.
  - Record pass/fail + evidence in `outcome/2.M-midpoint-review.md`. Any ❌ goes to deferred-items.md before Phase 3 starts.
  - _Requirements: REQ-075, REQ-043, REQ-083_

---

# Phase 3: CLI Entry Points (Tooling API Surface)

> **No GraphQL resolvers exist in this ticket** (REQ-060 enforces byte-identical schema). The CLI wrappers are the only entry surface; they MUST remain thin (≤ 60 lines, zero logic — plan D6/D8).

### Task 3.1 — `create-backup.ts` CLI Wrapper

- [ ] 3.1 Implement the backup entry point
  - Create `scripts/backup/create-backup.ts` — wiring only: `parseCreateBackupArgs` → `resolveBackupConfig` → `assertBackupToolchain` → `acquireBackupLock(dbName)` → `openExportSnapshot` → `buildManifestBody` (inside snapshot) → `runPgDump` (same snapshot) → `finalizeManifest` + write sibling manifest JSON → `closeSnapshot` → release lock → structured completion log (`logger` only: artifact path, byte size, durationMs, total rowCount) — every failure routed through `failWith` (exit taxonomy 2/3/4/5/6).
  - Add `.gitignore` entry for the backup output root if task 0.2 found the `db/` convention insufficient; assert via static check.
  - _Requirements: REQ-010, REQ-011, REQ-012, REQ-042, REQ-050, REQ-051_
  - [ ] 3.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts scripts/backup/create-backup.ts --lifecycle duplicates` (exit 0)
  - [ ] 3.1.TE **Test Engineering**: CLI-level integration suite (argv in → exit code + artifacts out): happy path produces dump+manifest; bad flag → exit 2; toolchain mocked absent → exit 4; existing artifact name → refusal; lock held → serialized/failed typed. DB-touching legs via `bun run scripts/run-test/run-test.ts`.
  - [ ] 3.1.SEC **Security & Tenancy Audit**: Log scan asserts NO `DATABASE_URL`/credentials in any emitted line; `.gitignore` coverage of output root asserted by test; artifact file perms respect umask with no world-readable forcing (REQ-032).
  - [ ] 3.1.SR **Semantic Review**: CLI ≤ 60 lines, zero business logic; all failures through taxonomy; no `console.*`.
  - [ ] 3.1.IV **Instruction Verification**: Root `AGENTS.md`; `docs/quality/ci-pipeline.md`.
  - Outcome: `outcome/3.1-outcome.md`

### Task 3.2 — `restore-verify.ts` CLI Wrapper

- [ ] 3.2 Implement the restore-verify entry point
  - Create `scripts/backup/restore-verify.ts` — wiring only: `parseRestoreVerifyArgs` → `resolveRestoreVerifyConfig` → `assertBackupToolchain` → manifest presence + `archiveSha256` pre-verification (tamper → exit 5, zero writes) → `assertRestorableScratchTarget` (exit 3 refusal) → `createScratchDatabase` → `runPgRestore` → `probeIdentityAndSequences` → verification registry V1–V10 → `writeReport` (PASS exit 0 / FAIL exit 5) → drop scratch (unless `--keep-scratch`) — all-or-nothing per REQ-041.
  - _Requirements: REQ-013, REQ-014, REQ-030, REQ-041, REQ-050_
  - [ ] 3.2.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts scripts/backup/restore-verify.ts --lifecycle duplicates` (exit 0)
  - [ ] 3.2.TE **Test Engineering**: CLI-level integration suite mirroring J2 legs end-to-end at the entry point (tampered manifest exit 5; corrupt archive; guard refusal exit 3 with zero writes; missing env key; garbage flags exit 2); happy-path PASS exit 0 with report written. Via `bun run scripts/run-test/run-test.ts`.
  - [ ] 3.2.SEC **Security & Tenancy Audit**: Ordering assertion — guard + checksum verification execute BEFORE any scratch creation or restore (ordering test); refusal writes zero bytes (JR-06).
  - [ ] 3.2.SR **Semantic Review**: Thin-wrapper rule; no duplicated lib logic; deterministic report ordering.
  - [ ] 3.2.IV **Instruction Verification**: Root `AGENTS.md`; `docs/DATABASE_MIGRATIONS.md`.
  - Outcome: `outcome/3.2-outcome.md`

---

# Phase 4: Frontend — INTENTIONALLY EMPTY (Zero-Surface Gates)

> **No frontend tasks exist.** REQ-061 mandates an empty diff on `frontend/**` and `app/**`; there are no views, stores, Apollo documents, or UI text keys. **No `.BF` / `.BS` agent-browser loops are scheduled** — fabricating browser passes over a non-existent UI would violate the honest-scoping rule. This phase instead executes the mechanical no-drift gates.

- [ ] 4.1 Execute and record the zero-frontend-surface gates
  - Run `git diff --name-only -- frontend/ app/` → MUST be empty; paste output into outcome.
  - Run `git diff --name-only -- backend/db/schema/ backend/db/migration/ backend/enum/` → MUST be empty (REQ-043).
  - Document in the outcome that agent-browser functional/visual loops (`.BF`/`.BS`) are N/A-to-ticket per specs §2.6 / plan §5, with the requirement citations.
  - _Requirements: REQ-061, REQ-043_
  - Outcome: `outcome/4.1-outcome.md`

---

# Phase 5: Integration & Differential Testing

- [ ] 5.1 Full journey-tier execution and determinism gates
  - Run `bun test test/workflows` — J1 + J2 suites green.
  - Run the J1 suite a SECOND consecutive time — MUST pass identically (REQ-073: flake = tooling defect, not test defect).
  - Determinism differential: verify the same artifact twice; assert byte-identical PASS reports (`diff` on the two report files) — REQ-044.
  - Run the failure-tier matrix suite complete (each REQ-050 exit code 2/3/4/5 exercised at least once across suites — J2 + CLI suites); produce a coverage table mapping exit code → asserting test.
  - Toolchain-gating check: simulate/record skip-with-signal behavior for binary-absent environments (REQ-053) — never a silent pass.
  - All DB-touching runs executed via `bun run scripts/run-test/run-test.ts <path>` with captured logs stored under `outcome/logs/`.
  - _Requirements: REQ-070…REQ-074, REQ-044, REQ-053_
  - Outcome: `outcome/5.1-outcome.md`

- [ ] 5.2 GraphQL no-drift gate + quality baseline closure
  - Run `bun run generate:gqlSchema && bun codegen`; diff generated `schema.graphql` and `frontend/graphql/generated/**` against the task-0.1 baseline checksums — MUST be byte-identical (REQ-060); record evidence.
  - Coverage gate: `bun test --coverage` on `scripts/backup/lib/**` — target 100% statement/branch on manifest/args/config/report/guard/serialization logic (REQ-075); record table.
  - Final quality counts: `bun tsgo`, `bun biome:check`, `bun run scripts/lint-service.ts --json --id final` — delta vs baseline MUST be +0.
  - _Requirements: REQ-060, REQ-075, REQ-001_
  - Outcome: `outcome/5.2-outcome.md`

---

# Phase 6: Post-Implementation Review Waves

> Waves run as parallel reviews; every finding becomes a ❌ deferred-item or an in-scope fix. Frontend-review wave is replaced by the CLI-surface equivalent; a dedicated pentester wave is mandatory (this tooling holds the keys to production data).

- [ ] 6.1 **Review Wave — Types & Contracts**
  - Verify: `manifest.types.ts` is the only new type module; zero new `backend/types/` files; zero entity redefinitions; i18n triple parity green under `tsgo`; env keys registered exactly once; reset-helper invalidation complete.
  - Record findings in `outcome/6.1-review-types.md`.
  - _Requirements: REQ-002, REQ-003, REQ-045_

- [ ] 6.2 **Review Wave — Backend/Scripts Logic**
  - Verify: snapshot-coherence ordering (manifest read inside snapshot window — REQ-040); lock released on all paths; all-or-nothing restore (REQ-041); V1–V10 each map loudly to their invariant citations; report determinism; CLI thinness; no module-level mutable state (REQ-018); no dead code; all suites green twice consecutively.
  - Record findings in `outcome/6.2-review-scripts.md`.
  - _Requirements: REQ-010…REQ-018, REQ-040…REQ-045, REQ-075_

- [ ] 6.3 **Review Wave — Pentester / Security Audit (MANDATORY for this tooling)**
  - Verify: no code path (flag, env, or internal) can restore into anything but a fresh scratch DB (attempt adversarial flag/env combinations in a review harness); argv-only spawning confirmed by static scan; no `console.*`; no credentials/host/connection strings in any log line, manifest, or report (grep fixtures with poisoned values); manifest contains no PII; report contains no row payloads; `.gitignore` covers output root; identity-agnostic guard vetting (plan §3.3); BOPLA closed-union parser proof; BOLA/BFLA structural-N/A rationale recorded with REQ-060 gate evidence.
  - Record findings in `outcome/6.3-review-pentester.md`.
  - _Requirements: REQ-030…REQ-034, REQ-050…REQ-053, JR-06_

- [ ] 6.4 **Deferred-Items Ledger & Baseline Delta Check**
  - `grep -c "❌\|⚠️" deferred-items.md` MUST equal 0 for all non-forward items; D1 and D2 remain as documented non-blocking forwards with owner references only.
  - Baseline delta = 0 on tsgo/biome/lint; all empty-diff gates re-verified one final time.
  - Record in `outcome/6.4-deferred-check.md`.
  - _Requirements: REQ-083, REQ-001_

---

# Phase 7: Knowledge Propagation & Documentation

### Task 7.1 — Canonical Doc: `docs/disaster-recovery/backup-and-restore.md`

- [ ] 7.1 Create the canonical DR doc
  - Create `docs/disaster-recovery/backup-and-restore.md` with the canonical structure: **Why** → Architecture of artifact + manifest (snapshot-coherence pattern, D2) → Rules (exit-code taxonomy 0/2/3/4/5/6; artifact hygiene; refusal list — what the tooling will NEVER do) → Verification invariant map (V1–V10 → invariant IDs INV-W/B/U/P/PAY/TV + decisions A.2–A.9/B.2–B.9/C.5) → RPO ≤ 24h / RTO ≤ 4h codification with the drill-budget mechanics → What NOT to Do (never in-place restore, never commit artifacts, never bypass the guard; `db reset`/`cleanGenerate` permanently disabled) → Launch-checklist evidence table mapping `PRODUCTION_READINESS.md` §7.1–7.7 to executable evidence (suite names + doc paths — REQ-019) → Rollout Summary → Related Documents (`docs/DATABASE_MIGRATIONS.md`, `docs/SQLITE_LOCAL_DEV.md` PG-only note, `docs/quality/ci-pipeline.md`, `docs/IDEMPOTENCY.md`, D1/D2 forward items with owners — REQ-081).
  - Any Mermaid diagram MUST pass `bun run scripts/validate-mermaid.ts`.
  - _Requirements: REQ-080, REQ-081, REQ-015, REQ-016, REQ-019_
  - Outcome: `outcome/7.1-outcome.md`

### Task 7.2 — Operator Runbook: `docs/disaster-recovery/dr-runbook.md`

- [ ] 7.2 Create the operator-facing DR runbook
  - Create `docs/disaster-recovery/dr-runbook.md` covering, step-by-step with exact commands (REQ-017): prerequisites & toolchain checks (pg_dump/pg_restore major-version match to server); producing a backup; verifying an artifact without restoring blind; executing a scratch drill; REAL production recovery procedure (environment provisioning expectations, restore, `bun db push` + `bun db migrate` forward-reconciliation, application health-verification order via the two sanctioned health probes from `docs/graphql/api-gateway-and-routing.md`, operator sign-off checklist); retention/cadence schedule table mapping to RPO ≤ 24h (with the documented ≤ 1h WAL/PITR upgrade path pointing to D1); RTO ≤ 4h timing budget table; failure-mode playbook (corrupted archive, missing manifest, schema-version skew, partial disk, managed-host restore refusal, stale lockfile manual clear); the explicit refusal list.
  - Mermaid-validate any diagrams.
  - _Requirements: REQ-017, REQ-080_
  - Outcome: `outcome/7.2-outcome.md`

### Task 7.3 — AGENTS.md Propagation (Rules-Only)

- [ ] 7.3 Propagate rule references
  - Root `AGENTS.md` Important References: add exactly ONE line pointing to `docs/disaster-recovery/backup-and-restore.md`.
  - If a `scripts/`-layer `AGENTS.md` exists governing these paths: add at most one rule line ("Backup/restore tooling: scratch-only restores via destructiveDbGuard; exit taxonomy + canonical doc at docs/disaster-recovery/").
  - Create/update `test/workflows/AGENTS.md` content policy check (already authored in 2.1 — confirm rules-only, no code recipes).
  - Content policy: rules/pointers only — NO code or recipes in any AGENTS.md (REQ-082).
  - _Requirements: REQ-082_
  - Outcome: `outcome/7.3-outcome.md`

### Task 7.4 — Completion Gates & Outcome Synthesis

- [ ] 7.4 Close the ticket
  - Verify EVERY task has its `outcome/<task-id>-outcome.md`; verify `outcome/plan-review-R1.md` predates the first implementation outcome (REQ-083).
  - Final gate record (single summary in the completion outcome): baseline delta = 0; `generate:gqlSchema && codegen` byte-identical; `git diff` empty on schema/migration/enum + `frontend/**` + `app/**`; journeys green ×2 consecutive; REQ-050 taxonomy fully test-pinned; V1–V10 all exercised with PASS + FAIL branches; `grep -c "❌\|⚠️" deferred-items.md` = 0 excluding the sanctioned D1/D2 forwards.
  - Write the REQ-019 evidence table (§7.1–7.7 → executable evidence) into the completion summary for DEV3-026 consumption.
  - Write `outcome/completion-summary.md`.
  - _Requirements: REQ-083, REQ-019, REQ-060, REQ-061, REQ-043_

---

## Traceability Snapshot (Task → Requirement)

| Task | Requirements |
|---|---|
| 0.1 / 0.2 | REQ-001, REQ-030/042/053 substrate, REQ-043/060/061 baselines, REQ-083 |
| 1.1 / 1.2 / 1.3 | REQ-003/011 · REQ-051/002 · REQ-045/012 |
| 2.1 / 2.2 / 2.3 | REQ-070/071/074 (+Invariant 10) · JR-01..05/07/08 · REQ-072/050/030 + JR-06/07 |
| 2.4–2.16 | REQ-050/051 · REQ-033/072 · REQ-045/020 · REQ-053/034 · REQ-042/018 · REQ-040 · REQ-011/031/044 · REQ-010/012/034 · REQ-030/013 · REQ-041 · REQ-014(3) · REQ-014/052 · REQ-052/016/044 |
| 2.M | REQ-075, REQ-043, REQ-083 |
| 3.1 / 3.2 | REQ-010..012/042/050 · REQ-013/014/030/041/050 |
| 4.1 | REQ-061, REQ-043 (agent-browser loops: N/A-to-ticket, recorded) |
| 5.1 / 5.2 | REQ-070..075/044/053 · REQ-060/075/001 |
| 6.1..6.4 | REQ-002/003/045 · REQ-010..045/075 · REQ-030..034/050..053/JR-06 · REQ-083/001 |
| 7.1..7.4 | REQ-080/081/015/016/019 · REQ-017 · REQ-082 · REQ-083/019/060/061/043 |
