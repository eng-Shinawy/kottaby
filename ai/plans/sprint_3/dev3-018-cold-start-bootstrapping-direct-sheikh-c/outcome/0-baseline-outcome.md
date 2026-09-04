# Task 0.1 Outcome — Baseline Errors & Ledger Initialization

**Date:** 2026-09-01
**Requirements:** REQ-001, REQ-076

---

## Summary

Baseline health metrics for DEV3-018 captured BEFORE any implementation work, the working tree was
verified clean at dispatch, the schema-drift pre-state was confirmed empty, and the deferred-items
ledger was seeded with the five pre-registered RESOLVED-REFERENCE entries from `plan.md`.

This is the ground truth against which Phase-5 end-gates measure deltas.

---

## Baseline Command Results

### 1. `bun tsgo`

- Command: `bun tsgo` (runs `scripts/lib/run-locked-cmd.ts tsgo tsgo -b --noEmit` after `restore-next-env-dts.ts`)
- Exit code: **0**
- Error count (`grep -c 'error TS'`): **0**
- Notes: process lock acquired and released cleanly; no TypeScript errors repo-wide.

### 2. `bun biome:check`

- Command: `bun biome:check` (runs `bunx @biomejs/biome check --write --unsafe .` under the process lock)
- Exit code: **0**
- Output: `Checked 1074 files in 2s. No fixes applied.`
- Warning count: **0** (zero diagnostics; "No fixes applied" on a `--write --unsafe` pass means a clean tree)

### 3. `bun run scripts/lint-service.ts --json --id baseline`

- Command: `bun run scripts/lint-service.ts --json --id baseline` (full-repo ESLint, no `-f`)
- Exit code (process): **0**
- JSON payload:

```json
{
  "success": true,
  "output": "",
  "exitCode": 0,
  "metrics": {
    "id": "baseline",
    "scope": "full-repo",
    "fileCount": 0,
    "durationMs": 22698,
    "queueDepthAtEnqueue": 0
  }
}
```

- Summary: `success: true`, ESLint `exitCode: 0`, empty output = **0 lint errors / 0 warnings repo-wide**.

### Baseline vector (the Phase-5 comparison must show ZERO deltas)

| Check   | Baseline errors | Baseline warnings |
|---------|-----------------|-------------------|
| tsgo    | 0               | 0                 |
| biome   | 0               | 0                 |
| lint    | 0               | 0                 |

---

## Working-Tree Purity

### `git status --short` at dispatch

```
(empty)
```

### `git diff --name-only` at dispatch (verbatim)

```
(empty)
```

The tree was clean as expected at dispatch. The ONLY modifications introduced by this task are this
plan-directory's own ledger/outcome files (`ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c/…`).

### Schema-drift pre-state

- Command: `git diff --stat -- backend/db/schema/ backend/db/migration/`
- Output: **empty** — NO drift now; re-verified at Phase 5.

---

## Ledger Seed Confirmation

`ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c/deferred-items.md` already
existed as the project template (`Status Values` section included); the five pre-registered entries
from `plan.md` (Deferred items section, lines 480–484) were INSERTED into the ledger table:

| ID | Item | Owning ticket | Status used |
|---|---|---|---|
| D-UI | Admin "Certify (cold-start)" affordance on the future admin teacher surface | admin teacher-management surface ticket | 📅 Forward — RESOLVED-REFERENCE |
| D-EVALUATOR-ELEVATION | Elevating `is_evaluator` on an ALREADY-certified teacher | separate governance mutation ticket | 📅 Forward — RESOLVED-REFERENCE |
| D-LOCALE-ROUTING | Per-recipient notification localization (`users.locale`) | engine D2 lineage (`docs/notifications/realtime-engine.md` §3.3) | 📅 Forward — RESOLVED-REFERENCE |
| D-RATE-LIMIT | Bespoke certification mutation rate limiter | rate-limiting hardening stream | 📅 Forward — RESOLVED-REFERENCE |
| D-GATE-SHARING | DEV3-022c/022d gate-module collision → consume-and-extend | cross-ticket coordination (REQ-004) | 📅 Forward — RESOLVED-REFERENCE |

Gate verification NOW:

```
$ grep -c "❌\|⚠️" …/deferred-items.md
0   (grep exit 1 — no matches, as required)
```

### Deviation (justified)

The stock template's `Status Values` legend embedded the ⚠️ and ❌ glyph characters in descriptive
lines, which alone makes the Phase-5 gate `grep -c "❌\|⚠️" deferred-items.md = 0` unsatisfiable even
with zero problem rows. The two legend lines were rewritten in text form ("glyph-form disallowed
here" + an explicit glyph-policy note stating that blocked/partial states are FORBIDDEN in this
ledger and findings must be recorded as RESOLVED-REFERENCE with an owning ticket). This is a
line-scoped legend edit in service of the plan's own end-gate; no ledger rows, template semantics,
or other files were affected.

---

## Files Changed

- MODIFIED `ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c/deferred-items.md`
  (inserted 5 RESOLVED-REFERENCE rows; rewrote the ⚠️/❌ legend lines per the deviation above)
- CREATED `ai/plans/sprint_3/dev3-018-cold-start-bootstrapping-direct-sheikh-c/outcome/0-baseline-outcome.md`
  (this file)

## Files Deliberately NOT Changed

- Nothing under `backend/db/schema/` or `backend/db/migration/` (zero-drift mandate; empty diff verified)
- No source files anywhere — this task is measure-and-record only
- `tasks.md` handled separately (checkbox flip only)

## Cross-File Dependencies

- Phase 5 (task 5.3) consumes this baseline vector; keep this file authoritative.
- Later tasks that discover verification failures must append ledger rows with `📅 Forward — RESOLVED-REFERENCE`
  statuses only (glyph policy above), or fix in-file per the fix-or-report rule.

## Deviations

- One and only one: the template legend glyph rewrite documented above. All other work matched the
  task definition exactly.
