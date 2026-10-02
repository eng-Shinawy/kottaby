# Disaster Recovery — Backup & Restore Verification

> **Scope:** operator runbook for database backup, guarded restore verification, and disaster-recovery drills.
> **Audience:** on-call operators and the engineer running the quarterly cold drill.
> **Posture:** shell-only ops tooling; zero application surface; every restore target is guard-assessed and explicitly confirmed.

---

## Summary

The disaster-recovery tooling is two registered ops scripts plus the artifacts and oracles they produce:

- **`bun run ops:db-backup`** — takes a transactionally-consistent logical backup (`pg_dump` custom format) into a timestamped run directory with a **`manifest.json`** (provenance, SHA-256, migration-journal fingerprint).
- **`bun run ops:db-restore-verify`** — restores a backup into an explicit scratch/staging target through a **triple safety gate**, then proves post-restore integrity with structural checks and **read-only invariant oracles**, writing a per-run **`restore-report-<UTC start stamp>.json`** report and a final `VERDICT`.

One-line purpose: *prove continuously that a backup taken by this repository can actually be restored — with wallet, escrow, audit, and notification truth intact — before the day we need to do it for real.*

---

## Why

The launch-readiness checklist (see `docs/planning/PRODUCTION_READINESS.md` §7) blocks launch on: backups performed on a schedule, a backup actually restorable to staging, data verified after restore, and an RTO/RPO that is defined — not an example value. This runbook is the procedure that checklist consumes.

The RPO/RTO are not paper numbers for this platform. The database holds **wallet balances, escrow holds, teacher transactions, and append-only audit logs**. A restore that silently loses rows, or a recovery that drags past a business day, corrupts financial truth and the audit trail simultaneously. Hence:

- **RPO 1 hour** — the platform can absorb at most one hour of lost transactions before reconciliation becomes forensic work rather than bookkeeping.
- **RTO 4 hours** — payments, escrow transitions, and session scheduling must be back inside a bounded window; every hour of dark time compounds user-visible breakage and support load.

Backup *existence* proves nothing; only a periodically **restored and verified** backup does. That is why the restore-verify half of this tooling is part of the DR surface, not an optional extra.

---

## Definitions

| Term | Value | Status |
|---|---|---|
| **RPO** (Recovery Point Objective) | **1 hour** | Ratified — no longer the checklist's "e.g." placeholder |
| **RTO** (Recovery Time Objective) | **4 hours** | Ratified — no longer the checklist's "e.g." placeholder |

**Budget arithmetic:**

- *RPO side:* worst-case data loss = **schedule interval + backup runtime + scheduling jitter**, so the cadence invariant is `interval + runtime + jitter ≤ RPO` — an hourly schedule alone does NOT bound loss at 1 hour. Measure the backup runtime from the manifest (`startedAtUtc` → `finishedAtUtc`) and pick an interval that satisfies the inequality with margin: with a measured runtime of ~5 minutes and ±2 minutes of timer jitter, a **30-minute** interval keeps the worst case ≤ ~37 minutes — comfortably inside RPO 1h. A daily-only schedule breaks this budget outright. Re-check the arithmetic after any dataset growth that lengthens the dump (see scheduling guidance below).
- *RTO side:* the full-recovery runbook (below) must complete in **≤ 2 hours** measured in a drill — that is the required **≥ 50 % headroom** inside the 4-hour RTO. The remaining 2 hours absorb region re-provisioning, manual secret re-entry, and cutover under stress.

---

## The Pattern

### Backup — `ops:db-backup`

```bash
bun run ops:db-backup [--env <file>] [--out-dir <dir>]
```

Registered verbatim in `package.json` as `ops:db-backup` → `bun run scripts/ops/backup-database.ts` (the raw entrypoint form is equivalent). `--help` prints the full usage text; parsing is strict (unknown flag or missing value → exit 2).

| Flag | Meaning |
|---|---|
| `--env <file>` | Env file to load (default `.env`). Must define a `postgresql://` `DATABASE_URL`. |
| `--out-dir <dir>` | Output directory (default `<repo>/backups`). Created if missing; artifacts are `0600`. |

**Artifact layout:**

```text
backups/
  20260905T103000Z/          # UTC-YYYYmmddTHHMMSSZ run dir ("-2", "-3"… suffix on collision — never overwrites)
    dump.pgc                 # pg_dump custom format (-Fc) — chmod 0600
    manifest.json            # chmod 0600 — provenance + integrity
```

`manifest.json` records: `tool`, `toolVersion`, `postgresServerVersion`, `pgDumpVersion`, `database`, `startedAtUtc`, `finishedAtUtc`, `artifactFile`, `artifactBytes`, `sha256`, `journalHash` (fingerprint of the applied migration journal in `backend/drizzle/`). A failed run preserves its staging directory as `<UTC-stamp>_FAILED` for inspection — never auto-deleted (see What NOT to Do).

**Exit codes:**

| Code | Meaning (backup) |
|---|---|
| `0` | Backup published (artifact + manifest written) |
| `1` | Operational failure (pg_dump error, empty artifact, manifest validation / publish failure) |
| `2` | Usage, environment, toolchain, lock-contention, or manifest-write failure |

**Error tags** (prefix on stderr lines): `[env]` (env bootstrap, DATABASE_URL, lock, usage, toolchain-probe refusals), `[pg_dump]` (dump stage), `[backup]` (backup-internal manifest-validation / publish failures), `[guard]` (restore-target refusal), `[pg_restore]` (restore stage), `[verify:<oracle-id>]` (a failed verification oracle, e.g. `[verify:OR-W1]`), `[verify]` (bare tag — artifact sha256/byte-size mismatch against the manifest, restore artifact/manifest errors, and report-writer failures such as a pre-placed entry at the per-run report path).

**Source-DSN refusals (fail closed, exit 2):** the backup bootstrap assesses the source `DATABASE_URL` the same way the restore guard assesses its target. A raw `?` or `#` inside the **authority span** (WHATWG and libpq disagree on where the authority ends — e.g. `postgresql://user?k@host:5432/db`), a raw fragment character `#` in the raw path or query (libpq reads through it as a literal), or a raw **control character** in any span (tab/newline/CR are stripped by URL parsers while libpq keeps the literal bytes; other C0 controls are percent-encoded away the same way) refuses with `[env] source DSN contains an unassessable character sequence — percent-encode special characters`; percent-encoded forms (`%23`, `%09`) are assessed by their decoded value and allowed, so the manifest records exactly the database dumped. A **dot-segment path** — a whole `.` or `..` path segment, raw or percent-encoded (URL parsers normalize it away while libpq treats the raw path as the literal database name, so the manifest would record a renamed database) — refuses with `[env] source DSN path contains dot-segments — use the literal database name`. A **db-less** source DSN — no path database and no `?dbname=` query — or an explicitly **empty** `?dbname=` value (libpq completes an empty database name from the USER name, never from the path) refuses with `[env] source database name is unspecified — name the database explicitly`, because the endpoint would be completed outside the DSN and the manifest would carry an unverifiable `(default)` marker (the backup-side mirror of the restore guard's target-naming rule). A query carrying an **endpoint-override** parameter — a `host`, `hostaddr`, or `port` key (case-insensitive, percent-decoded key match; a valueless key counts) — refuses with `[env] source DSN endpoint override in query string is not supported — put host/port in the DSN authority`: libpq applies query parameters ON TOP of the DSN authority, so the query channel could point the dump at an endpoint no authority-derived label names (a `?hostaddr=` even ships the dump off-box) — the authority names the endpoint, and plain query parameters (`dbname`, `sslmode`, `application_name`, …) are unaffected. A `service=` key is the same endpoint indirection one step removed — libpq resolves it through the connection-service file (`~/.pg_service.conf` / `PGSERVICEFILE`), whose entries decide the endpoint nothing in the URL view sees (live-proven: `postgresql://postgres@127.0.0.1/db?service=x` with a redirected service file made psql connect on port 5999) — and refuses with the distinct `[env] source DSN service indirection is not supported — name the endpoint in the DSN authority`. A **multi-host** endpoint — a comma (raw or percent-decoded) in the authority **host span** or in a query `host=`/`hostaddr=` value (libpq accepts comma-separated host lists in both channels and percent-decodes the host before the list is split, so the dump can fail over to an endpoint no URL-derived label names — live-proven: `postgresql://postgres@127.0.0.1,8.8.8.8:5432/db` completed a real backup while the manifest labeled only `127.0.0.1`; restore refuses the identical shape) — refuses with `[env] source DSN multi-host endpoints are not supported — name a single host in the authority`; a bracketed IPv6 host (`[::1]`) names one host and stays allowed. The five source-DSN gates run in a fixed precedence — ambiguous spans → dot-segments → multi-host → endpoint-override/`service` → unnamed-database — and the FIRST matching gate decides the emitted `[env]` message (e.g. a comma inside a query `host=` value reports the multi-host refusal, not the endpoint-override one).

**Consistency note:** `pg_dump` reads every table through a **single MVCC snapshot** — the artifact is transactionally consistent even while the application keeps running and writing. There is **no application pause** required. The lock footprint is a **shared (`ACCESS SHARE`) lock on each dumped table**: reads and writes continue unaffected; only concurrent DDL on the same tables would queue behind the dump. Schedule backups off the DDL/deploy window and off peak load; no other coordination is needed.

**Scheduling guidance** — copy-pasteable stanzas. The interval must satisfy the RPO-side budget arithmetic above (`interval + runtime + jitter ≤ RPO`); the half-hourly stanzas below assume a single-digit-minute dump runtime — re-derive the interval from YOUR measured `durationMs` if the dataset outgrows it:

```cron
# Every 30 minutes — the cadence that keeps worst-case loss (interval +
# runtime + jitter) inside RPO 1h with measured single-digit-minute dumps
5,35 * * * * cd /srv/kottaby && bun run ops:db-backup --env .env.production >> /var/log/kottaby/db-backup.log 2>&1

# Daily floor — the minimum cadence the launch checklist requires; the half-hourly cadence above is what RPO 1h demands
15 3 * * * cd /srv/kottaby && bun run ops:db-backup --env .env.production >> /var/log/kottaby/db-backup.log 2>&1
```

```ini
# /etc/systemd/system/kottaby-db-backup.service
[Unit]
Description=Kottaby Postgres logical backup (ops:db-backup)
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/srv/kottaby
ExecStart=/usr/local/bin/bun run ops:db-backup --env .env.production
```

```ini
# /etc/systemd/system/kottaby-db-backup.timer — every 30 minutes (RPO cadence;
# interval + measured runtime + RandomizedDelaySec jitter must stay ≤ RPO 1h)
[Unit]
Description=Half-hourly Kottaby DB backup

[Timer]
OnCalendar=*:00/30
RandomizedDelaySec=120
Persistent=true

[Install]
WantedBy=timers.target
```

For a daily-only timer, replace the `[Timer]` calendar with `OnCalendar=*-*-* 03:15:00` — this meets the checklist's daily minimum but **not** RPO 1h. Overlapping runs are safe: each run holds a run-directory lockfile; a second invocation while one is live exits `2` with `[env] another backup holds the run lock` — live locks are never stolen.

**Managed-PITR note:** provider-side point-in-time recovery (e.g. Neon PITR) is a **complementary layer**, never a substitute for the verified logical backup above — see the appendix (D-001) for the honest evidence status.

### Restore & verify — `ops:db-restore-verify`

```bash
bun run ops:db-restore-verify -- --from <runDir|artifact> --target <dsn> --yes-i-understand [--env <file>]
```

Registered verbatim in `package.json` as `ops:db-restore-verify` → `bun run scripts/ops/restore-verify.ts`. The `--` separates bun's own flags from the script's.

| Flag | Meaning |
|---|---|
| `--from <runDir\|artifact>` | Backup run directory (manifest.json + dump beside it) or a direct dump artifact whose manifest sits beside it. |
| `--target <dsn>` | Restore destination Postgres connection string. **REQUIRED — there is no default — and it must NAME the target database** (a database-less DSN is refused: ambient `PGDATABASE` would complete the endpoint; a query `?dbname=` names the target when the path is empty, and a path/query dbname disagreement is refused). Must be a scratch/staging database: the restore **restores the dump's public objects (pg_restore --clean drops objects contained in the dump before recreating them)** (`--clean --if-exists`). |
| `--yes-i-understand` | Explicit non-interactive confirmation of the destructive restore; refused without it. |
| `--env <file>` | Env file providing **source-database context** (`DATABASE_URL`) for row-count comparisons. When omitted, `.env` is attempted and its absence is non-fatal (comparisons are skipped). |

**What it checks, in order:**

1. **Artifact integrity** — resolves the manifest, re-computes the dump's SHA-256 and compares it to the manifest's recorded hash.
2. **Restore** — `pg_restore` of the verified dump into `--target` (guarded — see below).
3. **Structural verification** — expected tables derived from `backend/db/schema/` at runtime; critical-set row counts over `users`, `wallet`, `teacher_transaction`, `session`, `session_request_idempotency`, `audit_logs`, `notifications`, `parent_link_requests`; a non-empty source with a 0-row restored table fails; restored `__drizzle_migrations` state corresponds to the backup's journal fingerprint.
4. **Invariant oracles** — read-only SQL probes (a pure-data registry; new oracles are data appends):

| Oracle | Checks | Anchor |
|---|---|---|
| `OR-W1` | No wallet row with a negative balance | `INV-W1` |
| `OR-W2` | Every `teacher_transaction` row joins an existing wallet | `INV-W3` |
| `OR-B1` | Session holds non-negative with valid balance-lane provenance | `INV-B1/B8` |
| `OR-U1` | No `audit_logs` row with a null or dangling actor reference | `A.5/INV-U1` |
| `OR-U2` | Soft-deleted users retain their audit history rows | `INV-U4/U5` |
| `OR-REQ` | Every `session_request_idempotency` row references an existing user | `workflow 02` |
| `OR-MIG` | Restored trailing migration-journal hash matches the backup's fingerprint — STRICT: an absent tracking table passes only when the backup itself recorded no journal (journal-less source); against a real fingerprint it FAILS (lost migration rows) | `migration-journal` |

A failing or errored oracle prints `[verify:<oracle-id>]` and fails the run. Results persist into a **per-run report file `restore-report-<UTC start stamp>.json`** (chmod `0600`) in the run directory — the per-run name keeps repeat drills against the same retained artifact collision-free (the writer refuses to overwrite, never clobbers) — and the run ends with exactly one `VERDICT: PASS` or `VERDICT: FAIL` line.

**Exit codes:**

| Code | Meaning (restore-verify) |
|---|---|
| `0` | `VERDICT: PASS` |
| `1` | `VERDICT: FAIL`, restore failure, or artifact verification failure |
| `2` | Usage error, env bootstrap error, or safety-guard refusal |

---

## Guard & safety

The restore is destructive by design, so it sits behind a **triple gate** — all three are mandatory, and a refusal costs nothing (zero processes spawned):

1. **Explicit `--target`.** There is no default target; omission is a usage error (exit 2, zero spawns). "Whatever is in the env file" is the exact accident class this removes.
2. **Guard assessment of the exact spawn string.** The target is assessed by the repository's destructive-database guard (`assessDestructiveDbCommandSafety`) **before any process is started**. The target DSN is parsed once on the CLI into a single variable that reaches the guard and the `pg_restore` argv **unchanged** — the assessed string *is* the executed string, so there is no parse-then-reparse window. The assessment walks every connection channel the target opens; each rule below refuses **fail-closed** with a `[guard]` message, exit `2`, and **nothing** spawned:

   - **Every host signal is assessed.** Keyword/value conninfo targets (`host=x dbname=y`) are normalized for assessment only: `host`/`hostaddr`/`dbname` keywords are extracted with libpq last-occurrence semantics and synthesized into URL form for host-signal analysis. When both `host` and `hostaddr` are present, **both** values are assessed, in any token order. The same applies to a URI's query string: `?host=`/`?hostaddr=` are independent channels libpq applies **on top of** the authority, so an authority-only check would miss them.
   - **A numeric endpoint must be loopback.** `hostaddr` is the address libpq actually connects to, so a `hostaddr` naming a non-loopback address (anything outside `127.0.0.0/8` / `::1`) has no assessable host signal and refuses; a conninfo with `hostaddr` but **no** `host` is refused outright.
   - **Service indirection is unassessable.** A `service=` parameter — in a URI query or as a conninfo keyword — lets a service file decide the endpoint, so any target naming a service refuses.
   - **The target database must be named — in ONE place.** A URL with an empty/absent path database, or a conninfo without a `dbname=` keyword, refuses: with an under-specified DSN the ambient libpq environment (`PGDATABASE`) completes the endpoint and pg_restore would silently land in an operator-unintended database. A URI query `?dbname=` parameter names the database libpq applies **on top of** the path, so it counts as the explicit target (and the report records it); when the path **and** the query name **different** databases, the libpq URI families disagree on which one wins — that ambiguity refuses fail-closed. (Matching defense-in-depth: restore children receive no endpoint-deciding libpq variable — `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGSERVICE`, `PGSERVICEFILE`, `PGHOSTADDR` are stripped from the allowlisted child environment, and the per-request env passthrough is filtered through the same allowlist; backup children strip `PGSERVICE`/`PGSERVICEFILE` the same way.)
   - **The raw authority span must be clean.** libpq and URL parsers disagree about where a URI's authority ends when a raw `?`, `#`, or control character sits inside it (or a userinfo percent-decodes into an `@`/`/`), so such a target is unassessable and refuses. A **pathless** query — `postgresql://host:5432?sslmode=disable`, no `/` before the `?` — is the one form both parsers agree on; it is assessed normally through the query channels.
   - **The raw target path must be assessable.** Dot-segment paths (`.`/`..` segments) and raw fragment characters (`#`) in the target path are refused as unassessable: URL parsers normalize dot-segments away and end the path at `#`, while libpq treats the raw path as the **literal** database name — the assessed path would not be the path libpq restores into. Percent-encoded forms are assessed by their decoded value (libpq percent-decodes the path database), so `…/db%23x` restores into the literal `db#x` and the report labels exactly that.
   - **The guard analyzes what libpq connects to.** Host values are percent-decoded and re-assessed (libpq decodes before connecting; a malformed escape refuses), and trailing dots are stripped (`prod.rds.amazonaws.com.` is DNS-equal to the managed host); a value that cannot form a valid URL refuses the run. The **port is not a security signal** — the endpoint host is what the marker analysis assesses.

   Targets whose effective host matches managed-provider patterns (e.g. `*.neon.tech`, `*.rds.amazonaws.com`) or that carry production environment signals are refused.
3. **`--yes-i-understand`.** The destructive nature must be confirmed explicitly on the command line; there is no prompt-fallback, no env-var opt-out.

Supporting invariants:

- **Zero production mutation.** The scripts only ever *read* from the source database (probes, counts, journal fingerprint); the restore writes only to the explicit `--target`.
- **Artifact confidentiality.** Artifacts and the restore report are written `0600`; `/backups/` is gitignored. Run directories contain full row data — treat them as production secrets.
- **Never copy dumps into deploy artifacts, Docker images, or version control.** Dumps live in the operator-managed `backups/` store (and, post-launch, the off-site uploader — D-003); nowhere else. Validate the ignore rule with `git check-ignore -v backups/dump.pgc` (see appendix tip).

---

## Full-recovery runbook (step-timed)

**Prerequisite — toolchain lockstep rule:** the `pg_dump`/`pg_restore` client major version must be **≥ the server major version**. The backup tool probes this and fails closed with `[env]`; when the server is upgraded, upgrade the clients in lockstep — do not schedule backups with a stale client major.

**Prerequisite — connection context:** the provisioning and inspection commands in step 1 (`createdb`, `dropdb`, `psql`) use the ambient libpq connection environment — they take no DSN of their own. Run them with the connection context set explicitly (for example `export PGHOST=127.0.0.1`, plus credentials if the cluster requires them), or pass `-h`/`-U` per invocation; a bare shell without it fails on the local Unix socket.

Execute in order; fill the timing table during every drill and real recovery:

1. **Provision a scratch/staging database.** Fresh Postgres instance with known credentials. It must NOT be prod-shaped (the guard would refuse it) and must be disposable — the restore drops and recreates public objects in it.
   Concrete example: `createdb kottaby_drill_<UTC-stamp>` (unique, obviously-disposable name), then confirm it is empty: `psql -d kottaby_drill_<UTC-stamp> -tAc "select count(*) from pg_tables where schemaname='public'"` must print `0`.
2. **Take a backup — if no recent verified run exists.** If a current run directory with a validating `manifest.json` already exists (e.g. the last hourly run), reuse it; otherwise run `bun run ops:db-backup [--env <file>] [--out-dir <dir>]` against the source. Note the run directory path.
3. **Restore & verify.** Run `bun run ops:db-restore-verify -- --from <runDir|artifact> --target <dsn> --yes-i-understand [--env <file>]` with the run directory from step 2 and the scratch DSN from step 1. Wait for the final `VERDICT` line.
4. **Review `VERDICT` + report.** `VERDICT: PASS` required; open the run's `restore-report-<UTC start stamp>.json` in the run directory and confirm the structural row counts, the 7/7 oracle results, and the hash correspondence. A `VERDICT: FAIL` (or any `[verify:*]` / `[guard]` line you cannot explain) stops the runbook — investigate before proceeding.
   The report's key fields: `verdict`; `structural[]` (per-table `present` / `rowCount` / `sourceNonEmpty` / `ok` — non-critical tables report `rowCount: -1`, meaning "not counted"; only the critical set carries real counts); `oracles[]` (`id` / `passed`); and `durationMs` (restore+verify runtime). Per-run report names make re-drills collision-free — a crashed run simply leaves its own timestamped report behind; no manual cleanup is required before re-running this step (the writer still refuses to overwrite any pre-existing entry, by design).
5. **Sign-off.** Record: run directory, manifest SHA-256, verdict, total wall-clock, and the completed timing table into the drill evidence store. For drills, file evidence to the plan outcome directory (see Related Documents).

**Timing table (fill during the drill — leave no blanks in filed evidence):**

| Step | Start (UTC) | End (UTC) | Duration |
|---|---|---|---|
| 1 — Provision scratch DB | | | |
| 2 — Backup (if not recent) | | | |
| 3 — Restore & verify | | | |
| 4 — Review VERDICT + report | | | |
| 5 — Sign-off | | | |
| **Total** | | | |

**Budget:** the total must land comfortably inside the **4-hour RTO with ≥ 50 % headroom — i.e. ≤ 2 hours**. A drill total above 2 hours is a runbook defect: fix the procedure or the tooling before relying on it.

---

## Disaster playbooks

### (a) DB-content loss (region healthy — accidental deletion, corruption, bad migration)

1. Pick the **latest verified backup**: newest run directory whose `manifest.json` validates (hash + journal fingerprint). Do not eyeball `dump.pgc` alone — no manifest, no backup.
2. Execute the **full-recovery runbook** (above) against a freshly provisioned replacement database: provision → restore-verify → review `VERDICT: PASS` + report.
3. Cut the application's `DATABASE_URL` over to the replacement database only after `VERDICT: PASS`. Data between the backup timestamp and the incident is accepted loss under RPO 1h — reconcile from application/audit records if needed.

### (b) Full-region loss

1. **Re-provision Postgres** in a new region/provider from scratch (new instance, network, storage).
2. **Re-enter environment variables and secrets MANUALLY.** The scripts never export, transmit, or replicate env — the new environment is provisioned by the operator from the secret manager. Nothing in the backup artifacts contains credentials; that is by design, which is also why recovery includes this manual step.
3. Run the **full-recovery runbook** (steps 2–5) against the fresh instance: restore the latest verified run, require `VERDICT: PASS`, then cut the application over. This path is what the 2-hour drill headroom exists to absorb alongside provisioning.
4. If the managed provider offers point-in-time recovery (e.g. Neon PITR), it is a **complementary layer** for tight-RPO needs — its configuration and evidence status are tracked in the appendix (D-001) and are **not** part of this runbook's verified path.

---

## Drill procedure

- **Cadence:** quarterly, cold. The drill is executed by an operator who has **never seen the runbook before** — they execute it verbatim against scratch infrastructure. Familiarity hides friction; a cold operator surfaces it.
- **Friction rule:** every point where the operator hesitates, guesses, or improvises is a **runbook defect** — patch this document (or the tooling), never the operator's memory. The runbook must be executable by someone having their worst day.
- **Measure:** wall-clock per step in the timing table; total must be ≤ 2 h (RTO headroom rule).
- **Evidence:** file the completed timing table, run directory name, manifest SHA-256, final `VERDICT` line, and a copy of the run's `restore-report-<UTC start stamp>.json` to the plan outcome directory (see Related Documents), plus a friction log and any runbook patches applied as a result.

---

## Conventions

- **Operator-English stdout.** The ops-script family convention exempts operator tooling from the locale system; this exemption is documented here for auditors. Tool output is fixed operator-English written via `console.*` — it is not user-facing application UI, carries no domain copy, and is never localized. DSNs in all output are redacted.
- **Permission model — shell-only, BFLA by absence.** The DR tooling is registered shell scripts run by an operator. There is **no application surface**: no HTTP/GraphQL endpoint, no frontend hook, no backend service exposure. There is consequently **no per-role authorization surface to mis-configure** (broken-function-level-authorization is prevented by absence — nothing is exposed to authorize). Access control is the operator's own shell/system credentials on the host that runs the scripts.
- **Artifact hygiene.** Run directories: `0600`, gitignored (`/backups/`), confidential, never committed, never baked into images or deploy bundles, never pasted into tickets/logs/chats. The manifest's SHA-256 is the only cross-boundary reference an operator needs to quote.
- **Guard-assess the exact target DSN.** Any operator script that targets a database with a mutating tool MUST pass the exact target DSN through `assessDestructiveDbCommandSafety` before spawning — including every URL/conninfo normalization channel: query-string `host`/`hostaddr`/`port`/`service`, raw authority spans, and multi-host lists. The assessed string must be the string the tool dials.

---

## What NOT to Do

- **Never restore to a prod-shaped target.** The guard refuses managed hosts and production-signalled environments — that refusal is the safety rail working. **Never bypass it**: no env-var tricks, no hand-rolled `pg_restore` against a target the tool refused. If a legitimate target is refused, fix the target's shape (make it a real scratch) — not the guard.
- **Never count manifest-less dumps as backups.** A `dump.pgc` without its `manifest.json` (SHA-256 + journal fingerprint) cannot be verified and does not count toward recovery. "We have dumps on disk" is not a backup story.
- **Never auto-delete `<UTC-stamp>_FAILED` runs.** Failed runs preserve their staging directory for inspection. Remove manually after review, never automatically, and never before the failure is understood.
- **Never add a `--target` default.** No "default to the env file's database" convenience flag — restoring into whatever `DATABASE_URL` points at is the exact disaster the tool exists to prevent.
- **Never write secrets into artifacts or logs.** DSNs are redacted in tool output and the manifest carries no credentials. Keep any new output line redacted the same way; a backup artifact that leaks its own credentials is a second incident waiting.

---

## Rollout Summary

- Both tools are registered in `package.json`: `ops:db-backup` → `bun run scripts/ops/backup-database.ts`, `ops:db-restore-verify` → `bun run scripts/ops/restore-verify.ts`; artifacts land in the gitignored `/backups/`.
- This runbook is live at `docs/ops/disaster-recovery.md` and is the canonical DR procedure.
- Drill evidence accumulates in the plan outcome directory (Related Documents); each quarterly drill appends its timing table and friction log there.
- The launch-readiness §7 DR block consumes this runbook for sign-off — **checkbox authority stays with the launch-checklist gate**; this document supplies the procedure, the ratified RPO/RTO definitions, and the evidence trail that gate checks.

---

## Related Documents

- `docs/planning/PRODUCTION_READINESS.md` — §7 Disaster Recovery: the launch checklist this runbook unlocks (7.1 backup schedule, 7.2 restore-to-staging, 7.3 post-restore verification, 7.4 RTO, 7.5 RPO)
- `docs/DATABASE_MIGRATIONS.md` — migration pipeline and the destructive-database guard family the restore guard extends
- `docs/notifications/realtime-engine.md` — persist-first ruling: a database restore restores **notification truth** (rows are the record; pushes are best-effort hints, healed by post-restore catch-up refetches)
- `docs/specs/state-machine-invariants.md` — the invariant anchors (`INV-W1`, `INV-B1/B8`, `INV-U1`, …) the restore oracles pin
- `ai/finished_plans/milestone_4_integration_security_launch/disaster-recovery-backup-verification/` — the archived plan bundle (plan / specs / tasks) for this tooling; per-task outcome and review records live in the branch/PR history (PR #96)

---

## Appendix: Neon PITR / managed-backup evidence (D-001)

**Honest scope note.** This repository ships the **verification scripts and the documented procedure** only. The provider-side PITR/snapshot retention settings (Neon console) are configured and screenshot-evidenced by the operator **outside the repo** — tracked as deferred item **D-001** and owned by the launch-checklist gate. **No retention numbers are documented here, because none were observed. Nothing in this appendix is aspirational.**

**What was actually observed in the sandbox drill:**

- The drill source/target was a **local PostgreSQL 17 cluster** (trust authentication, port `5432`) — a real backup → restore-verify chain was executed against it.
- **No Neon console was available to observe**; therefore no console-side PITR/retention configuration is claimed or documented here.

**Ignore-rule validation tip.** The `/backups/` gitignore rule is directory-only (trailing slash), so a bare `backups` path does **not** match until the directory exists:

```bash
git check-ignore -v backups/dump.pgc   # matches: .gitignore:<n>:/backups/  backups/dump.pgc
git check-ignore -v backups            # does NOT match while the dir is absent/empty — use a real file path
```

Run the first form (a real file inside the directory) when auditing that artifacts cannot be committed.

---

## Deferred items

| ID | Item | Owner | Status |
|---|---|---|---|
| **D-001** | Neon PITR / managed-backup console configuration + screenshot evidence (outside the repo; consumes this runbook's appendix) | Operator / launch-checklist gate | 📅 Forward |
| **D-002** | Scheduled CI restore drill — `restore-verify` on a schedule against an anonymized staging dump (needs CI secrets for a scratch Postgres) | Post-launch DevOps CI hardening | 📅 Forward |
| **D-003** | Off-site (second-region / object-storage) upload of backup artifacts — the run-directory + manifest layout is uploader-ready; needs credential provisioning | Post-launch infrastructure | 📅 Forward |
