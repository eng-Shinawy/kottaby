```markdown
# Requirements & Specification: DEV3-024 — Disaster Recovery & Backup Verification

> **Target ticket:** `[DEV3-024] Disaster Recovery & Backup Verification` (Owner: Dev 3 · Sprint 4 · 5 SP)
> **Plan directory:** `ai/plans/sprint_4/dev3-024-disaster-recovery-backup-verification/`
> **Blocking dependencies:** None (explicitly unblocked). **Verification substrate dependencies (verify-only, never re-built):** DEV1-001 (schema ground truth: all tables, constraints, triggers via custom SQL), `scripts/lib/destructiveDbGuard.ts` (destructive-command safety gate), `docs/DATABASE_MIGRATIONS.md` (`db push`/`db migrate` discipline; `db reset`/`cleanGenerate` permanently disabled), `docs/SQLITE_LOCAL_DEV.md` (dual-dialect reality), `backend/db/seeds/` (fixture vocabulary), the `errors` i18n namespace triple, and CI's `tests-db` Postgres-16 service container (toolchain availability proof).
> **Critical reconciliation note:** The ticket's acceptance criteria reference "the production database" and "a staging environment." This repository contains **application code only** — there is no provisioned production/staging infrastructure in-tree (no Terraform, no managed-DB config, no CI deploy target). The ticket is therefore scoped to what a codebase can verifiably deliver: (a) an **operator-invoked backup tool** producing complete, integrity-manifested, restorable artifacts for the PostgreSQL deployment; (b) a **restore verification harness** that restores an artifact into an isolated scratch database and proves data/invariant fidelity; (c) **formal RPO/RTO definitions** with measurable drill criteria; and (d) the **DR runbook + canonical doc** that the M4 launch checklist (`PRODUCTION_READINESS.md` §7.1–7.7) cites. Physically executing the drill against real production is an operator act performed BY following the runbook — the ticket delivers the runbook, the tooling, and the machine-checkable proof that the tooling works. Scheduling (cron/managed-PITR) is deferred as an explicit, non-blocking forward item.

---

## 1. Executive Summary & Problem Statement

- **Feature**: Platform-level disaster recovery capability for Kottaby / Draft Academy. A `scripts/backup/` toolchain that (1) produces a complete, consistent, integrity-manifested PostgreSQL backup artifact; (2) restores that artifact into an isolated scratch database and verifies **every actor-class dataset and invariant** byte-for-byte and rule-by-rule (row counts, content hashes of financial tables, constraint/trigger presence, sequence health, FK integrity, soft-delete preservation, audit-trail continuity, escrow in-flight holds); (3) codifies **RPO ≤ 24h** (scheduled daily full dump; documented upgrade path to ≤ 1h via WAL archiving / managed PITR) and **RTO ≤ 4h** (timed drill criterion); and (4) ships the canonical DR documentation the M4 launch gate requires. This is an **operations/tooling vertical slice**: zero application runtime behavior changes, zero GraphQL surface, zero frontend surface, zero schema drift — with a permanent journey test proving the full round-trip against the real test database.

- **Problem from user perspective**:
  - **Super Admin / Platform Operator**: when the worst day arrives (database corruption, accidental destructive deploy, infrastructure loss), he must have a *tested* path back — not a hopeful one. `PRODUCTION_READINESS.md` §7 demands documented RPO/RTO, a tested backup, a verified restore, and a documented DR plan *before launch sign-off*. Today none exists.
  - **Student (Yusuf)**: his segregated session balances (`balance_hifz`/`balance_tajweed`/`balance_reviews`/`balance_trial`), parent link, and session history are value he paid for; losing them is a breach of trust and of INV-B/INV-U guarantees.
  - **Certified Sheikh (Sheikh Abdullah)**: his wallet balance and `total_earning` are real income; a restore that loses or corrupts `wallet`/`teacher_transaction` rows is a financial-integrity incident (INV-W1..W8).
  - **Teacher Applicant (Ibrahim)**: his `cooldown_until` and `verification_attempts` gate expensive re-entry to the evaluation loop (INV-TV3); losing them either double-charges him or lets a failed applicant slip back in early.
  - **Parent (Fatima)**: the `students.parent_id` link and handshake continuity must survive (A.2/A.3); a lost link silently severs supervision (INV-P).
  - **Dev 3 (owner) & Engineering Manager**: the M4 gate is blocked until §7.1–7.7 of `PRODUCTION_READINESS.md` are verifiably true with evidence, not prose.

- **Business value**: DR is a launch-gate item (`PRODUCTION_READINESS.md` §7, nine sign-off rows) and the ultimate backstop for the platform's two most legally/financially sensitive guarantees: immutable financial records (INV-W6/INV-PAY2) and permanent retention of reports/evaluations/recitations (INV-E6, Workflow 05 §8). Selling subscriptions with no verified recovery path converts every operational incident into potential revenue loss and regulatory/reputational exposure. A tested restore path converts "disaster" from an existential event into a bounded RTO exercise.

- **Actors involved**:
  - **Platform Operator (human, admin-class, shell access)** — invokes backup/restore tooling; executes the DR runbook. NOT an in-app role; no GraphQL identity.
  - **System (deterministic tooling)** — captures the snapshot artifact + manifest; performs restore; executes verification.
  - **Verification Harness (test/lint CI)** — proves round-trip fidelity continuously; gates regressions.
  - **Data-owning actor classes whose state MUST survive restore**: Student, Parent, Teacher/Certified Sheikh, Teacher Applicant, Super Admin (audit actor history). None of them *invoke* this feature; all of them are *stakeholders of its correctness* (§2.9 journeys phrase criteria from their observer perspective).
  - **Downstream consumers**: M4 launch checklist execution (DEV3-026 — cites this ticket's evidence), future infra/scheduling ticket (D1: retention + scheduling/WAL-PITR), future DR automation beyond documented drills.

- **Non-goals** (explicitly OUT of scope for DEV3-024):
  1. **Production/staging infrastructure provisioning** — Terraform, managed backup policies, Neon/RDS snapshot configuration, S3/Blob artifact storage wiring. Documented as external preconditions in the runbook; no code.
  2. **Scheduled/automated backup execution** (cron-service integration, `pg_cron`, managed PITR/WAL archiving enablement) — forward item D1; this ticket delivers operator-invoked tooling + documented cadence.
  3. **Point-in-time recovery (PITR)** machinery and incremental/WAL backup tooling — the RPO ≤ 24h contract is satisfied by full dumps; the ≤ 1h upgrade path is documentation-only.
  4. **Application-runtime read-replicas, failover, multi-region, high-availability topology** — none of it is in the repo.
  5. **Backup encryption at rest / key management** — artifact-handling rules (no VCS, operator-controlled storage) are mandated; cryptographic management is a documented operator obligation, not code (noted as forward hardening).
  6. **Any GraphQL operation, Apollo document, frontend view, route, or store** — verified as empty-diff gates (REQ-060/061).
  7. **Any schema, migration, enum, or seed change** — `git diff` on `backend/db/schema/**`, `backend/db/migration/**` SHALL be empty (REQ-043). Postgres-only tooling; SQLite local-dev dialect is explicitly out of scope and documented as such (REQ-020 note).
  8. **Data anonymization/scrubbing for non-prod restores** — restores target isolated scratch DBs in controlled environments; an anonymization pipeline for sharing dumps with third parties is out of scope (none exists in requirements).
  9. **In-app admin DR dashboard/indicators** — operator CLI + logs only.

---

## 2. Requirements & Acceptance Criteria (EARS Format)

### 2.1 Baseline & Foundational Preparation (MANDATORY)

- **REQ-001 (Pre-Implementation Baseline & Ledger)**: WHEN implementation begins THEN the executing agent SHALL record baseline error counts (`bun tsgo`, `bun biome:check`, `bun run scripts/lint-service.ts --json --id baseline`, `git diff --name-only`) AND SHALL initialize `ai/plans/sprint_4/dev3-024-disaster-recovery-backup-verification/deferred-items.md` from `.agents/spec-process-guide/templates/deferred-items-template.md`, pre-seeded with two non-blocking forward entries: **D1** (scheduled backups + retention + WAL/PITR upgrade → future infra/ops ticket, owner: platform infrastructure) and **D2** (artifact encryption-at-rest automation → future security-hardening ticket). Baseline SHALL be written to `outcome/0-baseline-outcome.md`; post-implementation delta SHALL be zero new errors.

- **REQ-002 (Type-Safe i18n & Enum Value Imports Compliance)**:
  - Any operator-facing script output that is user-visible prose (runbook-referenced messages, verification failure summaries) SHALL route through the compile-time i18n system (`getServerTranslations(locale, "<namespace>")` from `@/shared/locale/server-graphql`) or be pure machine output (paths, counts, codes) — never hardcoded English sentences in logic paths.
  - All enum usages in runtime expressions (e.g., `TransactionType`, `TransactionStatus`, `PaymentStatus`, `ApplicantStatus`, `SessionStatus` used by verification queries) SHALL be **value imports** (never `import type`) and enum members (never raw string literals).
  - FORBIDDEN anywhere in this ticket: `next-intl`, `getBackendTranslations`, `shared/messages/`, `console.*` (logger only: `@/backend/lib/logger`).

- **REQ-003 (Canonical Types Discipline)**: WHEN any type is needed THEN: no new DB entities exist in this ticket (zero tables/columns), so no new `{Entity}*Type` files are introduced; consumed entity types (`SessionSelectType`, `WalletSelectType`, `TeacherTransactionSelectType`, `StudentSelectType`, `ApplicantSelectType`, `AuditLogSelectType`, `DBTransaction`, etc.) SHALL be imported from `@/backend/types` only. The backup **manifest contract** (`BackupManifestReturnType`-class structured JSON descriptor) is tooling-internal, defined once in the `scripts/backup/` module it belongs to (or `backend/types/` ONLY if a second layer ever consumes it — it does not in this ticket), and documented in the canonical doc as deliberately outside the entity-type convention. No duplicate structural re-definitions of table shapes; manifest table metadata derives from the Drizzle schema object itself (single structural source of truth per `backend/db/schema/AGENTS.md`).

### 2.2 Core Feature Logic / Happy Paths

- **REQ-010 (Backup Artifact Production)**: WHEN an authorized operator runs the backup entry point (`bun run scripts/backup/create-backup.ts`, env-driven) against a configured PostgreSQL database THEN the system SHALL produce: (a) a `pg_dump --format=custom` archive capturing the FULL database (schema + data + constraints + indexes + triggers + enum types + sequences) in a single consistent snapshot; (b) a sibling **manifest JSON** (REQ-011); (c) deterministic, collision-resistant artifact naming (`<dbname>-<UTC-timestamp>-<short-hash>`), with REFUSAL to overwrite an existing artifact (operator must pass an explicit fresh output target); and SHALL emit a structured completion log (logger only) with artifact path, byte size, duration, and row-count summary.

- **REQ-011 (Integrity Manifest)**: WHEN a backup is produced THEN the manifest SHALL record, derived from the live DB **at snapshot time**: manifest schema version; source database name (never credentials/host detail); UTC capture timestamp; pg_dump/server version strings; a per-table record for EVERY application table (`rowCount`, plus `contentHash` — a deterministic hash over a stable, ordered projection — for the financial/immutable/integrity-critical set: `student_payments`, `teacher_transaction`, `wallet`, `audit_logs`, `subscriptions`, `students` balance columns, `applicants`); the Drizzle migration journal identity; and a whole-archive SHA-256 checksum of the dump file. The manifest SHALL be the ONLY comparison contract used at verify time.

- **REQ-012 (Artifact Hygiene & Location Rules)**: WHEN artifacts are produced THEN they SHALL land in a configurable output directory (env-config-registered, REQ-030-compliant) that is OUTSIDE version control (a `.gitignore` entry for the backup output root SHALL exist), SHALL never contain env files, secrets, or `.env*` material, and SHALL be plain local files whose custody/encryption is the operator's documented obligation (runbook). IF the output directory is missing/unwritable THEN the tool SHALL fail closed with a typed non-zero exit (REQ-050) and zero partial artifacts left behind (temp-write-then-rename into the final name).

- **REQ-013 (Restore Procedure into Isolated Scratch Database)**: WHEN verification or a drill runs (`bun run scripts/backup/restore-verify.ts`) THEN the system SHALL: (1) resolve the restore target **exclusively** to an environment-designated scratch location — by default a NEW database named `<source>_restore_<timestamp>` created on the LOCAL test Postgres ( deriving connection from `.env.test`/test config), never a pre-existing application database; (2) run the destructive-action gate (`scripts/lib/destructiveDbGuard.ts`) against the target and REFUSE managed/production-shaped targets; (3) `pg_restore` the archive into the scratch DB; (4) assert identity/sequence health (a probe insert into a safe table and cleanup, or setval verification from the dump's own sequence state); (5) run `$EXPECTED schema-order reconciliation` by reporting (NOT auto-applying) any Drizzle migration folders newer than the dump's journal — forward-compatibility is the runbook's documented "restore then `bun db push`/`migrate` forward" step; (6) execute the REQ-014 verification suite; (7) emit a machine-readable PASS/FAIL report and a non-zero exit on ANY divergence; and (8)) drop the scratch DB on success-by-default (configurable retention for drill inspection).

- **REQ-014 (Post-Restore Verification Suite — Content, Invariant, and Structural Fidelity)**: WHEN verification runs against a restored scratch database THEN it SHALL assert, with zero tolerance:
  1. **Manifest parity**: every manifest `rowCount` matches the restored table's live count; every `contentHash` table re-hashes identically.
  2. **Financial integrity (INV-W1..W8, INV-PAY1/2/4)**: all four balance lanes + trial lane per student are `>= 0`; `wallet.balance >= 0` and `wallet.total_earning >= 0`; for every teacher, `wallet.total_earning` equals the sum of COMPLETED `earning` transactions (consistency probe already proven by the DEV3-025 financial-safety contract family); `teacher_transaction.amount >= 0`; no `student_payments` row mutated in content hash terms.
  3. **Immutability substrate preserved (INV-W6/INV-PAY2, A.5)**: `audit_logs` and financial tables retain all rows AND their append-only protection triggers exist post-restore (trigger presence queried from `pg_trigger`; the PG trigger inventory from the custom migration SQL — e.g., audit immutability triggers — MUST be present).
  4. **Governance & retention (A.7, INV-U1/U4/U5)**: soft-deleted users remain present with `is_deleted = true`; their sessions/reports/financials remain reachable by FK; zero orphan FKs across the FK graph (referential scan over every declared FK: no child row lacking its parent — excludes intentional nullable/`set null` links such as `evaluations.sessionId`, `students.parentId`, `lessons.planId`, `progress.lessonId`, `studentPayments.subscriptionId`, `teacherTransaction.sessionId`, which are verified as NULL-consistent instead).
  5. **Domain spot invariants**: `students.handshake_code` unique post-restore (A.3); `recitation.session_id` unique 1:1 (C.5); `applicants.cooldown_until`/`verification_attempts` content-preserved (INV-TV3); in-flight escrow holds (`session.fee_held = true` with `status IN (scheduled, started)`) intact (B.4 — an in-flight hold must never vanish silently); `subscriptions` windows/`status` preserved (A.9).
  6. **Structural fingerprint**: table set diff between manifest and restored DB = ∅; required indexes/constraints present (spot-checked via catalog queries; full DDL fidelity follows from `pg_dump` custom format).
  6. **Time integrity**: no `createdAt`/`updatedAt` drift (timestamps compared by manifest hash where covered).

- **REQ-015 (RPO Definition & Enforcement Contract)**: WHEN this ticket ships THEN the Recovery Point Objective SHALL be codified as **RPO ≤ 24 hours** (daily full backup cadence, operator- or scheduler-executed per runbook), with the manifest's capture timestamp serving as the measurable RPO artifact; the documented upgrade path to **RPO ≤ 1 hour** (WAL archiving / managed PITR on the production provider) SHALL live in the canonical doc as an infrastructure prerequisite note tied to deferred item D1. No code in this ticket promises better than 24h.

- **REQ-016 (RTO Definition & Drill Criterion)**: WHEN the DR drill executes end-to-end (backup capture of the reference dataset → scratch restore → full verification PASS) THEN the wall-clock duration SHALL be measured and reported, and the **RTO SHALL be defined as ≤ 4 hours** with the CI/exercised drill time serving as the evidence baseline (the drill excludes human decision latency, which the runbook accounts for in its step-by-step timing budget). IF the automated drill exceeds a conservative internal budget (set to keep CI sane, e.g. minutes-scale for the tiny test dataset) THEN the test SHALL fail — proving the measurement itself works.

- **REQ-017 (DR Runbook Content)**: WHEN knowledge propagation completes THEN the runbook (living in `docs/disaster-recovery/`) SHALL cover, step-by-step with exact commands: prerequisites and tooling checks (`pg_dump`/`pg_restore` version match to server major); producing a backup; verifying an artifact without restoring blind; executing a restore drill; executing REAL production recovery (env provisioning, restore, `bun db push` + `bun db migrate` forward-reconciliation, application health-verification order via the two sanctioned health probes, operator sign-off checklist); retention/cadence schedule table mapping to RPO; RTO timing budget table; failure-mode playbook (corrupted archive, missing manifest, schema-version skew, partial disk, managed-host restore refusal); and the explicit list of what the tooling REFUSES to do (REQ-030).

- **REQ-018 (Deterministic Idempotent Tooling)**: WHEN any script is re-run WITHOUT changing inputs THEN: backup refuses clobber (new timestamped name per run — no mutation of prior artifacts); restore-verify produces a FRESH scratch DB each run and is fully re-runnable; verification of the same artifact is deterministic (identical report on consecutive runs). No module-level mutable accumulators across runs (process-per-run tools); no hidden state between invocations.

- **REQ-019 (Launch-Checklist Evidence Contract)**: WHEN the ticket completes THEN it SHALL emit evidence satisfying `PRODUCTION_READINESS.md` §7 rows 7.1–7.7: tooling for 7.1 (backup performed; cadence documented), 7.2 (restore to an isolated environment, proven), 7.3 (post-restore verification suite, machine-checked), 7.4 (RTO documented), 7.5 (RPO documented), 7.6 (DR plan documented), 7.7 (drill executed by automated journey test + recorded in outcome). Each claim SHALL point at executable evidence (suite name / doc path), never prose alone.

- **REQ-020 (Scope Guard — Verification-Only, Postgres-Only, App-Runtime-Intact)**: WHEN the tooling operates THEN it SHALL: never mutate the application database outside of producing a dump (read-only against source); never touch the SQLite dialect path (`DB_PROVIDER=sqlite` documented as unsupported by these scripts with a clear typed error, since `pg_dump` semantics are PG-only — `docs/SQLITE_LOCAL_DEV.md` parity noted); never modify application runtime configuration; and never require the Next.js server, Apollo, or any service layer to be running (tooling speaks only to PostgreSQL + the filesystem).

### 2.3 Security, Authorization & Tenancy

- **REQ-030 (Destructive-Action Guard Integration — CRITICAL)**: WHEN `restore-verify.ts` (or any future restore entry point) resolves its target THEN it SHALL route the decision through `scripts/lib/destructiveDbGuard.ts` (the same guard family that permanently disables `db reset`/`db cleanGenerate`): managed production hosts (Neon/Supabase/RDS/cloud markers in URL/env, `NODE_ENV=production` without an explicit drill allowance), and any NON-scratch database name SHALL be REFUSED with a typed non-zero exit and a localized, runbook-referenced message. There SHALL be NO flag, env var, or code path by which the standard restore flow overwrites an application database in place — the only restorable target is a freshly created scratch database. **A restore into production follows the runbook's manual operator procedure** (outside this tooling), which is precisely why the guard exists.

- **REQ-031 (Secrets & PII Hygiene)**: WHEN scripts log or emit output THEN: credentials, connection strings, tokens, and env bodies SHALL be redacted per the existing redaction conventions (`redactLogContext`-family discipline; never print `DATABASE_URL` bodies — log database NAME only); manifests SHALL contain no credentials, no connection strings, and no per-row PII (only counts/hashes); backup artifacts SHALL be documented as security-sensitive (they contain full row data incl. `passwordHash`/PII) with handling rules in the runbook (operator-controlled storage, no VCS, no ticket attachments, no CI artifacts upload per `docs/quality/ci-pipeline.md` artifact policy).

- **REQ-032 (Artifact Access Control Posture)**: WHEN tooling writes artifacts THEN permissions SHALL default to the operator's umask with world-readable permissions explicitly NOT set; the canonical doc SHALL instruct that production artifacts belong in operator/managed storage (access-controlled), and CI SHALL NEVER archive/attach artifact bytes (the CI pipeline's "no artifacts uploaded" policy applies — REQ-031).

- **REQ-033 (BOLA/IDOR, BOPLA, BFLA — Structural Non-Applicability, Verified)**: WHEN the surface is audited THEN it SHALL be recorded that: there is NO GraphQL/API operation (BFLA: no function surface to gate — verified by REQ-060 codegen no-drift); there is NO client input DTO (BOPLA: script args are a closed CLI union — explicit flag whitelist, no object spreads into any command construction); there are NO tenant-crossing object identifiers (BOLA: identity is the operator's own shell context + the env-configured source DB; the tooling never accepts per-row identifiers). Verification queries SHALL be static parameterized SQL/Drizzle against the scratch DB (no string-built table names from input; the table inventory derives from the Drizzle schema objects, not from CLI strings).

- **REQ-034 (Injection Surface)**: WHEN any command or query is constructed THEN: process spawning SHALL use argv arrays (no shell-string interpolation of paths/identifiers — mirrors `docs/quality/ci-pipeline.md` injection-defense posture); SQL SHALL be parameterized (Drizzle/`sql` templates with bound params, never concatenated values); there is NO LIKE/ILIKE user-text surface in this ticket, so `escapeLikeWildcards` is documented as N/A-to-this-ticket. No inline `--` comments inside any `sql` template (parameter-binding rule).

### 2.4 Atomicity, Concurrency & Data Integrity

- **REQ-040 (Snapshot Consistency)**: WHEN a backup is captured THEN the dump SHALL be a single `pg_dump` invocation whose consistency derives from PostgreSQL's MVCC snapshot semantics for that utility (one transactionally-consistent point in time for the whole database); the manifest SHALL be captured from the SAME coherent read session (open a read-only repeatable-read transaction for manifest queries BEFORE the dump begins, or document the ordering that keeps manifest-vs-dump skew bounded and benign — the chosen ordering SHALL be recorded in the design doc; manifest mismatch of that bounded class is tolerated ONLY where documented, never for `contentHash` tables, which are read inside the snapshot window).
- **REQ-041 (Restore All-or-Nothing Semantics)**: WHEN restore-verify runs THEN a failure at ANY stage (create scratch DB, pg_restore error, verification divergence, probe failure) SHALL result in a non-zero exit, a FAIL report naming the failing check, and cleanup of the partial scratch database (or explicit retained-on-failure flag for drill debugging); there SHALL be NO path that reports success with a partially restored/partially verified database.
- **REQ-042 (Concurrent-Execution Discipline)**: WHEN two backup invocations race over the same output root THEN the timestamp+hash naming makes artifact collision practically impossible, and an execution-level lockfile (existing `scripts/lib/process-lock.ts`-family mechanism, reusing the established pattern — verify existence before use; if absent, an `existsSync`-guarded lock file with stale-lock timeout) SHALL serialize concurrent backup runs per database source. Verification runs (read-only against source, scratch-scoped) MAY run concurrently with backups without interference.
- **REQ-043 (Zero Schema/Migration Drift)**: WHEN implementation completes THEN `git diff` on `backend/db/schema/**`, `backend/db/migration/**`, `backend/enum/**`, `backend/types/{domain entity files}/**`, and `shared/**` SHALL be empty except where REQ-080 documentation or explicit type additions are sanctioned (none planned); any discovered schema gap is a ❌ deferred-items entry, never an inline patch (`db reset`/`cleanGenerate` remain permanently disabled — `docs/DATABASE_MIGRATIONS.md` binding).
- **REQ-044 (Verification Repeatability)**: WHEN the same artifact is verified twice in a row THEN both runs SHALL produce byte-identical PASS reports (same counts, same hashes, same structural assertions); drift between consecutive verifications of one artifact SHALL be treated as a tool bug and fail the determinism test (REQ-073).
- **REQ-045 (Environment & Config Registration)**: WHEN any env value is consumed (output dir, source DB selection, scratch naming prefix, retention choices, drill budget) THEN each key SHALL be registered through the project's env-config resolution convention (`env-config-keys` registration; documented defaults; NO empty-string acceptance for paths); unconfigured restore-critical values SHALL fail closed with a typed error naming the missing key, never a silent default toward a destructive target. Reset/test helpers used in tests SHALL invalidate ALL resolved keys (cache-invalidation completeness rule).

### 2.5 Validation & Error Contracts

- **REQ-050 (Script Exit-Code & Failure Taxonomy)**: WHEN any script terminates THEN it SHALL use the taxonomy: `0` = success; `2` = operator/usage error (bad flags, missing env, unknown command); `3` = refusal by safety guard (REQ-030 target rejection); `4` = tool/dependency problem (`pg_dump`/`pg_restore` absent or major-version mismatch vs server); `5` = verification divergence (data/invariant mismatch — FAIL report written); `6` = unexpected internal failure (masked, logged with correlation). The taxonomy SHALL be documented in the canonical doc and test-pinned (each tier exercised by REQ-072 tests).
- **REQ-051 (Localized, Logged — Never Printed Raw)**: WHEN any message surfaces THEN `logger` (`@/backend/lib/logger`) SHALL be the only sink (no `console.*`); operator-facing failure messages SHALL resolve through `getServerTranslations` (a small, registered namespace/grouping per `shared/locale/AGENTS.md`, e.g. under `errors` or a new `disasterRecovery` grouping with full `types`/`en`/`ar` parity — compile-time `MessageSchema` parity is the gate); structured context fields (codes, paths, counts, durations) remain machine tokens, not prose.
- **REQ-052 (Failure Report Content Discipline)**: WHEN verification fails THEN the written FAIL report SHALL contain the failed check ID, expected vs actual (counts/hashes, not row payloads), artifact path, scratch DB name, and remediation pointer to the runbook section — and SHALL NOT contain per-row sensitive content (no PII dump in failure reports).
- **REQ-053 (Fail-Closed Toolchain Probing)**: WHEN a script starts THEN it SHALL verify `pg_dump`/`pg_restore` availability + server major-version compatibility BEFORE doing any work (exit `4` closed path otherwise); in test environments lacking the binaries, suites SHALL gate (skip-with-signal, following the `describeLiveWhen`/flagged-test precedent — never silent pass).

### 2.6 GraphQL & Frontend Contracts

- **REQ-060 (Zero GraphQL Surface — No-Drift Gate)**: WHEN `bun run generate:gqlSchema && bun codegen` run at completion THEN the generated schema and artifacts SHALL be byte-identical to baseline (zero new queries/mutations/objects/inputs/enums); any diff fails the ticket.
- **REQ-061 (Zero Frontend/App Surface)**: WHEN implementation completes THEN `git diff` on `frontend/**` and `app/**` (excluding nothing — the rule is absolute) SHALL be empty; no Apollo documents, no views, no routes, no stores, no UI text keys beyond the script-message namespace of REQ-051.

### 2.7 Test Coverage

- **REQ-070 (Journey Test — Full Cross-Actor Round-Trip, MANDATORY)**: WHEN the DR journey executes (`test/workflows/disaster-recovery/backup-restore-roundtrip.journey.test.ts`, real services + real test DB) THEN it SHALL: build committed fixtures covering EVERY actor class (student with all four balance lanes + handshake + parent link; parent; certified teacher with wallet + completed earning; teacher applicant with `cooldown_until` + `verification_attempts > 0`; super admin + `audit_logs` rows; an in-flight `fee_held = true` session; a soft-deleted user with preserved history) via journey fixture helpers; run the REAL backup tool against the test database; restore into a fresh scratch DB via the REAL restore-verify path; assert the full REQ-014 verification result is PASS; and assert per-actor observer criteria (§2.9). `runInRollback` is FORBIDDEN here (tooling opens its own connections); fixtures are committed in `beforeAll`, hard-deleted in `afterAll` with tracked IDs, and the scratch DB is dropped in teardown. Side effects (none external: no email/SMS/notification dispatch exists in this flow) noted in the suite header.
- **REQ-071 (Actor-Fixture Matrix Assertions)**: WHEN the journey asserts THEN it SHALL include per-class checks: student balance quadruple + trial lane equality; parent link (`parent_id`, handshake code) equality; teacher `wallet.balance`/`total_earning` + `teacher_transaction` content hash equality; applicant cooldown fields equality; admin audit rows count + hash equality; soft-deleted user presence; in-flight escrow hold present with identical `fee_held`/`confirmationDeadline`.
- **REQ-072 (Failure-Tier Test Matrix)**: WHEN negative tests run THEN they SHALL cover: tampered manifest (single rowCount mutation) → exit `5` FAIL naming the check; corrupted archive (truncated bytes) → non-zero with tool/taxonomy-correct code; missing manifest → refusal before restore; guard rejection of a production-shaped target URL → exit `3` with the localized refusal; missing env-config key → closed typed failure naming the key; flag-parsing garbage → exit `2`. Each exit-code tier SHALL be exercised at least once (REQ-050 pin).
- **REQ-073 (Determinism & Repetition Gate)**: WHEN the verification suite completes THEN the same artifact SHALL be verified twice consecutively with byte-identical PASS reports (REQ-044), and the journey suite SHALL pass two consecutive full runs; any flake is a defect in the tooling, not the test.
- **REQ-074 (Execution Conventions)**: WHEN tests execute THEN they follow `bun run scripts/run-test/run-test.ts <path>` for DB-touching suites (log capture mandatory); script-logic unit tests (manifest builder, arg parser, guard mapping, report writer) follow the standard service-tier conventions with all external process/IO mocked; no test SHALL touch the network or any provider API (this is NOT `test/integration/` territory — local PostgreSQL tooling is in-process infrastructure, and the workflow layer owns the round-trip).
- **REQ-075 (Quality Gates & Baseline)**: WHEN tasks complete THEN every created/modified file SHALL pass `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0); new script logic SHALL target 100% statement/branch coverage on manifest/verification/parsing code; final tsgo/biome/lint counts SHALL equal the REQ-001 baseline + 0.

### 2.8 Documentation & Knowledge Gates

- **REQ-080 (Canonical Doc + Runbook)**: WHEN knowledge propagation runs THEN `docs/disaster-recovery/backup-and-restore.md` SHALL be created (Why → Architecture of artifact+manifest → Rules → What NOT to Do → Exit-code taxonomy → Verification invariant map → Rollout Summary → Related Documents), AND `docs/disaster-recovery/dr-runbook.md` SHALL exist as the operator-facing step-by-step runbook of REQ-017 (prereqs, backup, verify, drill, real recovery, retention/cadence, failure playbook, refusal list, RPO/RTO budget tables). Both SHALL pass `bun run scripts/validate-mermaid.ts` if they contain diagrams.
- **REQ-081 (Launch-Checklist Cross-Link)**: WHEN docs land THEN the canonical doc SHALL explicitly map to `PRODUCTION_READINESS.md` §7.1–7.7 (the evidence table of REQ-019), cross-link `docs/DATABASE_MIGRATIONS.md` (guard policy + restore→`db push`/`migrate` forward reconciliation) and `docs/SQLITE_LOCAL_DEV.md` (PG-only tooling note), and record the deferred item D1 (scheduling/WAL-PITR) + D2 (encryption-at-rest automation) with owner direction.
- **REQ-082 (AGENTS.md Propagation — Rules Only)**: WHEN propagation runs THEN root `AGENTS.md` Important References SHALL gain one line for the canonical doc; NO layer AGENTS.md gains code/recipes; if a `scripts/`-layer AGENTS exists governing these paths it gains at most a 1-line rule reference; content policy = rules/pointers only.
- **REQ-083 (Completion Gates)**: WHEN the plan closes THEN: Phase-1.5 `@plan-review` outcome (`outcome/plan-review-R1.md`) SHALL predate implementation; every task SHALL have `outcome/<task-id>-outcome.md`; `grep -c "❌\|⚠️"` on the ledger SHALL equal 0 for all non-forward items (D1/D2 remain as documented non-blocking forwards with owners); baseline delta SHALL be zero; REQ-060/061 no-drift diffs SHALL be recorded.

### 2.9 Cross-Actor Workflow Scenarios (Journeys) — MANDATORY

**Why mandatory here**: although no two human roles interact through an app surface, this ticket's round-trip crosses FIVE actor-class datasets over shared state (the PostgreSQL cluster): Student, Parent, Certified Teacher, Teacher Applicant, Super Admin (audit history), exercised by two operational actors (Operator, Verification Harness). Failure fidelity for ANY class = silent platform corruption on restore day. Journeys map 1:1 to `test/workflows/disaster-recovery/` suites (journey rules: real services + real test DB, committed fixtures, NO `runInRollback`, hard-delete teardown, side effects spied/none present). If `test/workflows/` is absent in the tree, scaffolding it (helpers + `test/workflows/AGENTS.md` codifying these rules) is a required task of this ticket.

**Actor Table**:

| Actor | Kind | Can | Cannot (MUST be denied/absent) |
|---|---|---|---|
| Platform Operator | Human, shell-level, admin-class | Run backup; run restore-verify into scratch; execute runbook recovery | Restore over a live/production target via tooling (guard REFUSES); overwrite artifacts; see secrets in logs |
| System (backup tool) | Tooling | Read full source DB snapshot; write artifacts + manifest | Mutate source DB rows; include secrets/env in artifacts; write into VCS-tracked paths |
| Verification Harness | Tooling/test | Create/drop scratch DBs; restore archives; assert invariants | Touch the application DB; mark partial restores as PASS; accept missing manifests |
| Student (dataset class) | Data stakeholder | Have balances (incl. trial), handshake, sessions restored identically | (observer) ANY balance/handshake/parent-link divergence post-restore is a FAIL |
| Parent (dataset class) | Data stakeholder | Keep the confirmed `parent_id` link + monitoring chain | (observer) A silently severed link is a FAIL (INV-P1 chain) |
| Certified Sheikh (dataset class) | Data stakeholder | Keep wallet/total_earning/transaction ledger byte-identical | (observer) ANY wallet/transaction drift is a FAIL (INV-W1..W8) |
| Teacher Applicant (dataset class) | Data stakeholder | Keep `cooldown_until`, `verification_attempts`, status | (observer) Lost cooldown state is a FAIL (INV-TV3 integrity) |
| Super Admin (dataset class) | Data stakeholder | Have complete `audit_logs` history + immutability triggers post-restore | (observer) Missing audit rows or missing append-only triggers = FAIL (A.5/INV-W6 lineage) |

**Ordered Step List — Journey J1 (Certified Round-Trip Drill)** — each step: `actor -> action -> shared-state change / side effect`:

1. **Harness -> fixture build** -> committed rows for all 7 dataset classes (tracked IDs registered for teardown).
2. **Operator (via runner) -> invoke backup** -> artifact + manifest exist; source DB row counts unchanged (read-only proven); log has zero secrets.
3. **System -> snapshot integrity** -> manifest validates against artifact checksum; naming non-colliding; nothing written inside repo tree.
4. **Harness -> resolve restore target** -> guard approves scratch target; second leg asserted: production-shaped target REFUSED (exit 3).
5. **Harness -> pg_restore into scratch** -> scratch DB populated; scratch is a NEW database (never the app DB); probe insert proves identity/sequence health.
6. **Harness -> verification suite** -> REQ-014 full PASS; consecutive re-verify byte-identical (REQ-044).
7. **Dataset observers**: Student 항목 balances identical; Parent link intact; Teacher wallet hash identical; Applicant cooldown intact; Admin audit rows + append-only triggers present; in-flight `fee_held` session intact; soft-deleted user + history preserved.
8. **Harness -> report + teardown** -> PASS report written; scratch DB dropped; fixtures hard-deleted by tracked IDs; no residual state (second run passes identically).

**Ordered Step List — Journey J2 (Hostile / Failure Legs)**:
1. **Harness -> tamper manifest** (one rowCount flipped) -> verification FAIL exit 5 naming exactly that table; restore artifacts quarantined by report.
2. **Harness -> present corrupt archive** -> typed tool/verification failure (never a partial-PASS).
3. **Operator -> attempt restore into production-shaped target** -> guard refusal exit 3 + localized message + zero bytes written.
4. **Operator -> attempt run without required env config** -> closed failure naming the missing key.
5. **Operator -> garbage CLI flags** -> exit 2, usage surfaces.

**Cross-Actor EARS Criteria (observer-phrased)**:

- **JR-01**: WHEN the round-trip drill completes THEN the Student's four balance lanes, handshake code, and parent link SHALL equal their pre-backup values exactly (observed by the Student's restored row).
- **JR-02**: WHEN the wallet-bearing teacher's dataset is restored THEN the Teacher's wallet row and entire transaction ledger SHALL be content-identical (observed via manifest hash; the Sheikh's income record is provably intact — INV-W6).
- **JR-03**: WHEN an applicant with an active cooldown is restored THEN the Applicant's `cooldown_until`/`verification_attempts`/`status` SHALL be preserved verbatim (INV-TV3 cannot be silently evaded by a restore).
- **JR-04**: WHEN the admin's audit history is restored THEN every pre-backup `audit_logs` row SHALL exist and the append-only protection triggers SHALL be present and functional (observed structurally; A.5 continuity survives disaster).
- **JR-05**: WHEN an in-flight escrow hold exists at backup time THEN the restored session SHALL retain `fee_held = true` and its original `confirmation_deadline` (B.4: a held credit can never vanish through recovery).
- **JR-06**: WHEN the Operator attempts a restore against a production-shaped target THEN the System SHALL refuse with exit code 3 and SHALL write zero bytes to that target (observed by the untouched target).
- **JR-07**: WHEN any verification check fails THEN the Operator SHALL receive a FAIL report identifying the exact check — and SHALL never receive a PASS for a partially restored database.
- **JR-08**: WHEN the drill is executed end-to-end THEN the measured restore time SHALL be recorded against the RTO ≤ 4h budget and the manifest timestamp SHALL evidence the RPO ≤ 24h metric (observed in the drill report).

Each journey criterion maps 1:1 onto assertions in `test/workflows/disaster-recovery/backup-restore-roundtrip.journey.test.ts` (J1) and `…/failure-legs.journey.test.ts` (J2) in `tasks.md`.

---

## 3. System Decisions & State Machine Invariants Alignment

### Decision References (`docs/specs/open-decisions-and-gaps.md`)

| Decision | Relevance to DEV3-024 | Binding Requirement |
|---|---|---|
| **A.5 (audit_logs, append-only)** | Restore MUST preserve both the rows AND the PG triggers enforcing immutability (custom-SQL trigger inventory from `backend/db/migration/` rides inside a full `pg_dump`); verified structurally post-restore. | REQ-014(3), JR-04 |
| **A.7 (governance on `users`)** | Soft-deleted/suspended/blocked users and their history survive restore; verification asserts `is_deleted` rows present + history reachable (INV-U1/U4/U5). | REQ-014(4) |
| **A.2/A.3 (parent link + handshake)** | `students.parent_id`, unique `handshake_code` preserved and uniqueness re-verified post-restore. | REQ-014(5), JR-01 |
| **A.9 (subscription windows)** | `subscriptions.status/start/end` preserved — expiry math must not shift through recovery. | REQ-014(5) |
| **B.2 (24h confirmation timeout)** | A restored in-flight session keeps its ORIGINAL `confirmation_deadline` (no re-arming through restore). | REQ-014(5), JR-05 |
| **B.3/B.4 (platform fee; hold-at-request escrow)** | In-flight holds (`fee_held=true`, statuses scheduled/started) survive intact — recovery must never strand or free a hold silently. | REQ-014(5), JR-05 |
| **B.6/B.7 (applicants lifecycle)** | `cooldown_until`, `verification_attempts`, `status` content-preserved; post-restore the DEV2-004 guard reads the same truth (INV-TV3). | REQ-014(5), JR-03 |
| **B.9 (offline payment audit fields)** | `subscriptions.payment_*` preserved (payment append-only lineage crosses the table boundary). | REQ-014(2/3) |
| **C.5 (recitation 1:1 per session)** | `recitation.session_id` uniqueness verified post-restore. | REQ-014(5) |
| **C.1 (parent role)** | Parent dataset class participates as a first-class fixture/observer. | REQ-071, §2.9 |
| **`docs/IDEMPOTENCY.md`** | Tooling reruns are idempotent by construction: no clobber, deterministic verify, fresh scratch per run; no app idempotency keys are exercised (no domain mutation occurs). | REQ-018, REQ-044 |
| **`docs/DATABASE_MIGRATIONS.md`** | Guard integration (REQ-030) cites the destructive-policy lineage; restore→forward-reconciliation (`db push`/`db migrate`) is the ONLY schema step, never `reset`/`cleanGenerate` (both permanently disabled). | REQ-013(5), REQ-030, REQ-043 |
| **`docs/SQLITE_LOCAL_DEV.md`** | Dual-dialect reality acknowledged: tooling is Postgres-only; SQLite local dev simply doesn't use it (documented, typed refusal). | REQ-020, REQ-017 |

### State Machine & Lifecycle Invariants (`docs/specs/state-machine-invariants.md`)

- **INV-S1..S8**: Restoration is status-faithful (no transition occurs during backup/restore); INV-S4 FKs re-verified; in-flight `started` sessions + their lock state (`teacher.is_online=false`) preserved byte-identically — verification asserts content, not re-derivation.
- **INV-TV1..TV7**: the applicant lifecycle state survives; INV-TV3's guard reads the same post-restore `cooldown_until` (JR-03).
- **INV-A1..A4**: presence-availability flags (`is_online`, `lastActiveAt`) are data, preserved as-is; no re-computation during restore.
- **INV-B1..B8 (incl. DEV1-004's trial lanes/B7/B8 posture)**: all non-negative checks true post-restore; trial markers (`trial_granted_at`) preserved — grant-once remains once forever.
- **INV-W1..W8**: wallet consistency probe (balance >= 0; total_earning == sum of completed earnings) executed against the restored DB; financial hashes identical (JR-02).
- **INV-U1..U5**: soft-deleted users + histories preserved; governance flags preserved (JR-04-adjacent; REQ-014(4)).
- **INV-P1..P4**: parent links survive (JR-01); read-only model unaffected (no runtime change at all).
- **INV-PAY1..PAY5**: `student_payments` content-identical; immutability triggers present.
- **INV-HW/PR/E families**: reports/homework/evaluations/recitation rows retained verbatim (permanent retention INV-E6 enforced by whole-DB snapshot fidelity + spot content hashes).

### Canonical Workflow & Standards Alignment

- **Workflow 05 (Admin Governance)** §8 data-integrity trio (zero hard deletes, financial immutability, permanent retention) is the property set this ticket *preserves through catastrophe*; §7 audit-trail continuity is JR-04.
- **Workflows 01–04**: their datasets (applicant lifecycle, matching presence, sessions/escrow, parent links) are the fixture classes the journey instantiates (§2.9).
- **`docs/quality/ci-pipeline.md`**: artifact-no-upload policy respected (REQ-032); the tooling's exit taxonomy is CI-friendly; scripts stay out of the required-check universe unless a dedicated check is added later (explicitly NOT done here to keep CI blast radius zero).
- **`docs/graphql/api-gateway-and-routing.md` / `error-handling-contract.md`**: N/A by scope (zero network surface) — recorded so absence isn't mistaken for omission.
- **`docs/planning/PRODUCTION_READINESS.md` §7**: this ticket is the section's implementing deliverable; REQ-019 binds the rows to executable evidence.

---

## 4. Cross-Layer Traceability Matrix

| Requirement ID | Decision Ref / Invariant | Backend Service / Tooling | GraphQL Mutation/Query | Frontend View | Test Coverage |
|---|---|---|---|---|---|
| REQ-001..003 | Spec-driven Phase 0; i18n/enum compliance; canonical types | `ai/plans/sprint_4/dev3-024-…/` artifacts; scripts consume `@/backend/types` only | — | — | baseline outcome; tsgo MessageSchema gate; review waves |
| REQ-010..012 | Whole-DB snapshot fidelity; manifest integrity; VCS hygiene | `scripts/backup/create-backup.ts`; manifest writer; `.gitignore` entry | — | — | Journey J1 steps 2–3; unit tests for naming/manifest/clobber refusal |
| REQ-013 | Restore isolation; `docs/DATABASE_MIGRATIONS.md` reconciliation posture | `scripts/backup/restore-verify.ts` (scratch DB lifecycle, pg_restore, sequence probe, drift report) | — | — | Journey J1 steps 4–5; J2 leg 5 (missing env) |
| REQ-014 | INV-W1..W8, INV-PAY1/2, INV-W6, A.5, INV-U1/U4/U5, INV-B1..B8, INV-TV3, B.4, A.2/A.3, A.9, C.5, INV-E6 | Verification suite module (`scripts/backup/verify-restored-db.ts`) reading Drizzle schema inventory | — | — | J1 step 6 (full PASS); per-assertion matrix tests; REQ-073 determinism |
| REQ-015 / REQ-016 | RPO/RTO codification (PRODUCTION_READINESS §7.4/7.5) | Manifest timestamp; drill timing in report | — | — | Drill-duration budget assertion in J1; docs review |
| REQ-017 / REQ-080 | Runbook completeness; knowledge propagation | `docs/disaster-recovery/dr-runbook.md`, `backup-and-restore.md` | — | — | Doc-structure checklist; mermaid validation; REQ-081 linkage review |
| REQ-018 / REQ-044 | Idempotent tooling; determinism | Lockfile/lock-guard usage (reuse `scripts/lib/process-lock.ts` if present — verify-before-use) | — | — | REQ-072/073 double-run tests |
| REQ-019 | PRODUCTION_READINESS §7.1–7.7 | Evidence table in canonical doc + suites | — | — | Outcome-file evidence links; DEV3-026 consumption note |
| REQ-020 | PG-only; app-runtime intact; `docs/SQLITE_LOCAL_DEV.md` | Typed refusal on sqlite provider; read-only source access | — | — | Unit test: sqlite config → typed refusal; no-mutation assertion in J1 (source counts unchanged) |
| REQ-030 | Destructive-guard policy (`docs/DATABASE_MIGRATIONS.md`) | `destructiveDbGuard` integration in restore target resolution | — | — | J2 leg 3 (exit 3, zero writes); unit matrix over managed-host shapes |
| REQ-031..032 | Secrets/PII hygiene; artifact custody | Redaction discipline; env-registered paths; no CI artifacts | — | — | Log-scan assertions; `.gitignore` static check; manifest-no-credentials unit test |
| REQ-033..034 | BOLA/BOPLA/BFLA structural N/A; argv-only process spawning | Closed CLI flag union; parameterized verification SQL | — | — | Security review wave + J2 leg 5; static scan: no shell-string spawn, no `{ ...input }` |
| REQ-040..045 | Consistency, isolation, zero drift, env registration | Snapshot ordering; guarded output; scratch-only restoration; env-config keys registered w/ reset completeness | — | — | REQ-043 empty-diff gates; REQ-075 quality/baseline gates; forced-partial-failure test (no false PASS) |
| REQ-050..053 | Exit taxonomy; logger-only; fail-closed tooling probe | Exit-code map; `getServerTranslations` message path; `pg_dump` version probe | — | — | REQ-072 full taxonomy matrix (each code exercised); tool-absence gating test |
| REQ-060..061 | Zero GraphQL/frontend surface | — | Byte-identical codegen gate | Empty `frontend/**`/`app/**` diff gate | Outcome diff evidence |
| REQ-070..075 | Journey test discipline (cross-actor, real DB, no `runInRollback`, committed fixtures + hard-delete teardown) | `test/workflows/disaster-recovery/*.journey.test.ts` + scaffolded helpers/AGENTS if the directory is absent | — | — | J1/J2 suites green ×2 consecutive; coverage 100% on new script logic; run-test captured logs |
| REQ-081..083 | Doc linkage; AGENTS rules-only policy; completion gates | Root `AGENTS.md` one-liner; plan-review outcome; ledger grep = 0 (D1/D2 forward-only) | — | — | Phase-1.5 gate artifact; final baseline delta = 0 |

**Traceability note for consumers**: DEV3-026 (production launch checklist) SHALL cite this ticket's REQ-019 evidence table when executing `PRODUCTION_READINESS.md` §7; the future infra/scheduling ticket owning D1 (retention + scheduling + WAL/PITR) and the security-hardening ticket owning D2 (artifact encryption-at-rest) SHALL reference `docs/disaster-recovery/backup-and-restore.md` rather than re-deriving the artifact/manifest/guard contracts defined here.

---

**End of Specification — DEV3-024.** Ready for `ai/plans/sprint_4/dev3-024-disaster-recovery-backup-verification/plan.md` (Phase 2 design), gated by `@plan-review` (Phase 1.5) before any implementation begins.
```
