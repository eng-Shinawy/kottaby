# Launch Gate — Production-Readiness Verification Harness

> **Scope:** the resumable launch gate under `scripts/launch/` — the machine harness that turns the
> production-readiness checklist (`docs/planning/PRODUCTION_READINESS.md`) into reproducible per-row
> evidence and a computed final verdict. Operator-side launch procedures (scheduler arming, backup
> schedules, sidecar boot) live in `docs/ops/launch-arming-runbook.md` and
> `docs/ops/disaster-recovery.md` — they are launch **conditions** the gate records as evidence rows;
> nothing in the repo can prove an environment is armed.

## Why

A launch sign-off is only as strong as its weakest evidence row. The launch gate exists because a
checklist executed by hand cannot be re-derived later: verdicts drift into folklore, deferred work
disappears, and "should be fine" replaces proof. The gate enforces four principles:

1. **Reproducibility.** Every machine-verifiable verdict must be re-derivable from the repository
   alone — a canonical command, its exit status, and a repo-relative evidence reference. A future
   auditor re-runs the command and gets the same verdict; the evidence reference points at the
   captured artifact.
2. **Honesty over greenness.** The gate fail-closes. A missing drill artifact, an unsigned waiver,
   or an operator placeholder in a command is a recorded FAIL with a named row — never a silent
   skip, never a tuned number. A below-target measurement is recorded against its target, not
   reframed.
3. **Waivers are first-class records.** Deferred work is a signable exception carrying a `why`, a
   named owner, and (at sign-off) a signatory — backed by a green command whenever the shipped
   behavior is real. A waiver without a signatory blocks launch exactly like a failed row.
4. **Human irreducibility.** Signature rows and sign-off tables are existence-marked only. The
   machine never signs for a human, and never auto-passes a row whose proof is a human act.

## Pattern

### Harness components

The harness reuses the repo's proven orchestration idioms: the progressive per-file runner
(`scripts/health/sub-loop.ts`), the quality-gate stage-state/resume pattern
(`scripts/quality-gate.ts` + `.quality-gate-state.json`), the stamped ops reports
(`scripts/ops/`), and the log-capturing test runner (`test/scripts/run-test.ts`).

| Component | Role |
|---|---|
| `scripts/launch/launch-checklist.ts` | **Row registry** — the single source of truth: every checklist row mapped to its owning stage, proof modality, canonical command, and evidence reference; waiver metadata (`why`, `owner`) lives beside the row it applies to |
| `scripts/launch/launch-gate.ts` | **Resumable CLI** — executes rows stage-by-stage through their canonical commands, persists state after every stage, halts at the first FAIL, writes the report on completion |
| `scripts/launch/launch-gate-dryrun.ts` | **Read-only pre-flight** — walks the registry, audits command targets, validates state machinery, and emits a sample report to a temp path without executing anything |
| `scripts/launch/launch-report.ts` | **Stamped report writer + verdict computation** — exclusive-create JSON with an allowlisted field set (redaction by construction) |
| `scripts/launch/shared/launch-types.ts` | Shared type module (deep-imported; no barrel) |
| `scripts/launch/probe-decisions.ts`, `probe-constraints.ts` | Read-only live-DB catalog probes (schema-shape and constraint-inventory verification) |
| `scripts/launch/secrets-scan.ts` | Explicit-target literal-secret scanner (never emits matched content) |
| `scripts/launch/verify-cron.ts` | Armed-surface corroboration probe (cron route envelopes, fan-out transport resolution, sidecar liveness) |

### Stages and state

Nine stages mirror the checklist sections (`s1` data integrity → `s9` final gate). Progress persists
to `.launch-gate-state.json` at the repo root (`{stage, owner, lifecycle, lastRun}`), exactly like
the quality gate's state file. Key mechanics:

- **Resume:** an interrupted run re-enters at `STAGES.indexOf(state.stage)`; passed stages never
  re-run. A corrupted or malformed state file falls back to a fresh start — it never throws.
- **`--fresh`** deletes the state file ONLY — never any cache.
- **`--dry-run`** is fully read-only: it re-proves registry resolvability, per-stage inventory,
  state round-trip, and report emission in under a second. A green dry-run is the pre-flight for
  every real run.
- The multi-hour run is wrapped in the repo's process lock; the gate registers for the lock's
  timeout exemption so long stages are not killed by the default lock timeout.

### Row modalities and execution semantics

Every registry row carries one of four proof modalities:

- **AUTOMATED-TEST** — the canonical runner command is spawned verbatim (no shell, no invented
  invocations): `bun run test/scripts/run-test.ts <path>` for suites with log capture,
  `bun run test:graphql <path>` for wire suites, or a probe CLI.
- **SCRIPT-PROBE** — a read-only probe CLI whose stdout is one JSON record per line
  (`{rowId, result: "PASS" | "FAIL", detail}`); exit 0 iff every line is PASS. An unreachable
  database, route, or target is a **named FAIL line** — probes never skip silently and never emit
  `WAIVED`.
- **MANUAL-DRILL** — never executed by the gate; the row is marked from the **existence** of its
  filed evidence artifact. A missing artifact is a launch-blocking FAIL. Wildcard stamps in the
  evidence path glob-match the filed artifact.
- **DOC-SIGNOFF** — never executed; existence-marked from a ratified document or a sign-off table.
  The gate checks the artifact exists — it never interprets or auto-passes a human's signature.

Additional execution semantics that keep the run honest: repeated commands within a stage run once
and their result is reused by sibling rows (the evidence reference already co-cites the same log);
a command still carrying an operator placeholder (`<...>`) is a config error that FAILs its row —
the gate never spawns a half-filled command; and **self-referential rows** (criteria whose command
is the gate CLI itself) are never spawned — the process lock is descendant-re-entrant, so a spawned
gate would recurse the whole run. Those rows are lineage-certified: the gate only reaches the final
stage after every earlier stage passed, so a criterion evaluated there is PASS from that lineage.

## Rules

### Dispositions and the verdict

Every executed row ends in exactly one of three dispositions:

| Disposition | Meaning | Requirement |
|---|---|---|
| `PASS` | The canonical command exited green | Executed command + captured evidence reference |
| `WAIVED` | The command ran green **and** the registry carries waiver metadata for the row | `why` + named `owner`; the signatory is the one the humans recorded in the row's own checklist line (`Signatory: …`), ingested read-only at report assembly |
| `FAIL` | Anything else — and it **blocks** | Named row, halt-on-first-failure within a stage run |

The final verdict is **computed, never coerced**: `VERDICT: PASS` if and only if there are zero FAIL
rows **and** every waiver record carries a non-empty signatory (waiver-to-row matching is by rowId).
Consequences that are deliberate:

- **An unsigned waiver blocks launch exactly like a FAIL row.** A fully green run still reports
  `VERDICT: FAIL` while any waiver row's `Signatory:` cell is missing, empty, or malformed. Do not
  "fix" this — it is the sign-off contract.
- **Waiver signatories are ingested, never fabricated.** The gate reflects exactly what the humans
  recorded: at report assembly it reads each waived row's own `Signatory: <name> (<date>)` cell
  from `docs/planning/PRODUCTION_READINESS.md` — read-only — and copies that value into the
  report's waiver record. A missing document, a missing row, or a malformed cell maps to the
  unsigned state `""`, which keeps the verdict FAIL; the gate never defaults, invents, or
  self-signs a signatory, and a signatory recorded on any other row is never ingested.
- **This ingestion is separate from the DOC-SIGNOFF existence rule.** `MANUAL-DRILL`/`DOC-SIGNOFF`
  rows (including the §9 signature rows) remain **existence-checked only** — the gate proves their
  evidence artifact exists and never interprets its content as a signature. The signatory content
  check applies solely to the eight waived rows' `Signatory:` cells, via the ingestion above.
- Stage status is strictly `PASS | FAIL` — waivers are row-level and ride in a separate `waivers`
  array. Never widen a stage status to include `WAIVED`.
- The gate CLI exits 0 iff the final verdict is PASS; a halted run exits with the failing row's
  status.

### The deferred-items ledger (three-way disposition model)

Deferred work is tracked in the plan's deferred-items ledger, where **every row is a
resolved-pointer** carrying a disposition target and a named owner — deferred-by-design, not
unresolved work:

- ✅ **evidence** — the row's command ran green; cite command + artifact.
- ☐ **WHY waiver** — a signable exception with a named owner; green evidence underneath is
  recorded inside the waiver text whenever the shipped behavior is real.
- **FAIL blocks** — a row that cannot pass is a launch blocker; it is never softened into a
  waiver retroactively.

Ledger hygiene: a pointer without a named owner is a silent drop; a waiver without a signatory is a
launch FAIL; re-opening a ratified deferral requires a new plan, not an edit.

### Report and evidence discipline

- **Stamped, exclusive-create reports:** `docs/planning/launch-report-<UTC-stamp>.json`. The writer
  fails closed if the stamped file already exists — a same-second double run never clobbers a
  committed report; distinct runs get distinct stamps.
- **Structural redaction:** the serializer copies exactly the allowlisted report fields into fresh
  objects — any extra runtime property (planted secrets, DSNs, tokens) is dropped before
  serialization. Run the secrets scanner over the emitted report before committing it.
- **Evidence references are repo-relative paths** — captured suite logs under `logs/`, probe
  captures and load artifacts under `scratch/`, or filed drill artifacts at their contract paths.
  Every executed row's evidence reference must resolve to a captured artifact.
- **A resumed completion emits only the rows its invocation executed** — the harness accumulates no
  per-row state across invocations. Earlier stages' verdicts stand on their own runs' captured
  evidence; never present a resumed report as coverage of stages it did not run.
- **Existence ≠ verdict:** for drill-artifact rows, verify the filed report's verdict field (a
  FAIL-verdict report filed at the contract path must not pass the row on mere existence) — and
  **never file a FAIL-verdict drill report as launch evidence.**

### Population-sensitivity rules for shared-database tests

The gate runs against shared dev/test databases that other suites and sessions also write to. Three
hazard classes recur, and each has a prescribed response:

1. **Fixture accumulation.** Suites that assert "my new row appears in page 1" break once the
   shared DB accumulates more rows than the page size (list queries typically order by
   creation time ascending). Before attributing such a failure to code: re-run the suite
   standalone; count the population the assertion depends on. If the population is machine-generated
   fixture residue (recognizable generated-email patterns, zero audit rows, barren dependent
   clusters), prune it with the repo's own sanctioned teardown helpers — FK-safe order, guard
   triggers re-verified armed afterward — and re-run. The durable fix is re-basing the assertion
   (query the row's own page), not shrinking the data.
2. **Trigger-state residue.** Concurrent suite teardowns can leave immutability triggers DISABLED
   on the shared DB if a process is killed mid-suite. Before attributing a trigger-tier failure to
   code, check the trigger's enabled state in the catalog and repair with `ALTER TABLE ... ENABLE
   TRIGGER` — a disabled trigger turns an immutability suite red for reasons unrelated to any diff.
3. **Credential drift.** Bun auto-loads `.env`, which can override a suite's fallback admin
   credential while the test database was seeded with the seed-fallback value. Symptom: CI-green /
   local-red `UNAUTHORIZED` at admin login. Repair is to align the shell environment with the seed
   contract (env, never argv) — and route the durable fix (suite sources the credential from the
   seed contract) to the suite's owner.

A related pre-check protects restore/verification suites that assert audit completeness: a
fixture-factory path that soft-deletes users without audit rows leaks barren rows into the shared
database and fails the audit oracle. The restore-oracle pre-check (soft-deleted users with no
audit rows for their id must count zero on the suite's source DB) belongs in the operator's
pre-flight.
### Probe discipline

- **Read-only, fail-closed, explicit-target.** Probes run catalog SELECTs / file reads only; an
  empty or missing target list is a named FAIL (never an auto-default corpus); error details are
  scrubbed before emission; a probe never emits matched secret contents — findings carry path,
  count, line number, and rule only.
- **No schema-code involvement.** DB probes pin their expectations as catalog-level ground truth
  inside the probe itself — they deliberately do not import the schema, so a schema-source edit
  and the live catalog cannot silently agree with each other. Static censuses and live probes are
  independent drift oracles: update both halves (and any pin test) in the same change.
- **Sidecar liveness is a plain HTTP 426.** The notification WS sidecar has no `/health` endpoint;
  its answer to every non-upgrade request — status 426 — **is** the liveness oracle. A probe
  carrying credentials to a liveness check is a defect.

## Anti-patterns

- ❌ **Never auto-pass a MANUAL-DRILL or DOC-SIGNOFF row.** Those rows are existence-marked; the
  gate never executes a human oracle or interprets a signature table.
- ❌ **Never record a waiver without a signatory surface.** The verdict rule blocks it — an
  unsigned waiver is a launch FAIL, not a ledger state.
- ❌ **Never spawn a half-filled command.** An operator placeholder in a registry command fails the
  row; substitute the real value (or file the waiver) at the owning decision point.
- ❌ **Never hand-edit or delete the gate state file to skip a stage.** Resume semantics trust the
  stage index; `--fresh` is the only sanctioned reset.
- ❌ **Never clear caches as part of a gate run.** `--fresh` deletes the state file only.
- ❌ **Never tune a number to force green.** Load/latency numbers are recorded as-found; a
  below-target number feeds a waiver or a fix, never a reframe. The only fail-closed thresholds a
  perf harness should own are structural ones (e.g. driving-table sequential scans, uncovered
  foreign-key columns, unexplained socket drops) — latency targets are recorded evidence.
- ❌ **Never run a single-IP load drill and call the result serving-path percentiles.** The
  gateway's per-IP limiter dominates a single-source run; record the per-status split (the
  2xx-only percentiles are the serving path) and drive production drills from distributed source
  IPs. A paced WS handshake is mandatory — the sidecar's per-IP handshake bucket throttles bursts
  by design; pace the client, never weaken the throttle.
- ❌ **Never trust a partial (resumed) report as full coverage.** Re-verify the earlier stages'
  evidence separately, or run a single halt-free invocation.
- ❌ **Never widen `StageResult.status` to include `WAIVED`** — waivers are row-level.
- ❌ **Never attribute a shared-DB failure to a code diff before the population/trigger/credential
  checks above** — deterministic re-run first, then attribute.
- ❌ **Never let a probe emit secrets, matched content, or internal ids** — scrubbed details,
  counts, and catalog names only.
- ❌ **Never re-open a ratified deferral without a new plan** — re-confirmation at sign-off is the
  sanctioned path.

## Rollout Summary

The gate was built and exercised in waves, and each wave left durable lessons:

1. **Harness first, self-verify before use.** The type module, row registry, report writer, gate
   CLI, and probe skeletons landed before any real stage execution, capped by a `--dry-run`
   self-verification that walked every row with zero spawns. Every subsequent stage run started
   with a green dry-run pre-flight.
2. **Halt points are semantics, not failures.** Real runs halted at: a shared-DB population
   overflow (fixture residue), a stale test oracle that predated a shipped feature, an operator
   placeholder awaiting a production URL, and pending drill artifacts. Each halt was
   root-caused, attributed to its owning party, and resolved by that party — the gate never
   papered over a halt by skipping the row. The stale-oracle case is the canonical example:
   when a committed feature intentionally changes a contract, the older suites asserting the
   pre-change contract are the defect, and their owning wave updates them to the new contract
   (superset assertions, never re-baselined minimal edits).
3. **Cross-session collision protocol.** When an uncommitted sibling session owns a file a task
   must touch, the task halts and reports a cross-file dependency with reconciliation options
   instead of editing over it; the orchestrator rules (e.g. layer the new tier additively on top
   of the sibling's wiring). Files settled (mtimes quiet, git state unchanged) may proceed with a
   minimal additive edit that preserves the sibling's exported surface.
4. **Drills are filed at contract paths.** Manual-drill rows cite exact filing paths agreed at
   registry time; the drill executor files the artifact (and the gate existence-marks it). The
   DR cold-restore drill demonstrated the pattern: run the runbook verbatim, investigate any
   failing oracle before proceeding, remediate source-data drift when the failure reproduces
   identically in the source, re-execute from step 1, and file only the PASS-verdict report —
   recording the FAIL run and its friction log as honest history.
5. **The verdict is the sign-off input, not the sign-off.** A completed run emits a stamped
   report and a computed verdict; the human sign-off surface (the checklist's signature table,
   criteria checkboxes, and waiver signatories) is filled by the named humans against that
   report. The gate's job ends at reproducible evidence.

## Related Documents

- `docs/planning/PRODUCTION_READINESS.md` — the executed checklist; its sign-off section is the
  human record of record (row-edit protocol, waiver notation, signature table).
- `docs/ops/launch-arming-runbook.md` — operator-side launch arming (cron routes, environment
  keys, sidecar boot, arming evidence procedure).
- `docs/ops/disaster-recovery.md` — the DR runbook the §7 drill rows execute (RPO/RTO arithmetic,
  restore oracles, drill procedure).
- `docs/quality/ci-pipeline.md` — the CI stages that run before any launch-gate stage.
- `docs/quality/linting-rules.md` — the lint discipline every gate-touched file passes
  (per-file `scripts/health/sub-loop.ts` loop before use elsewhere).
