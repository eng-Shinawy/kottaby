# Evidence Matrix — §6. Performance & Load Testing (Task 5.3 · REQ-013 AC-3)

**Checklist section:** `docs/planning/PRODUCTION_READINESS.md` §6 — Performance & Load Testing · **7 rows** (5 SCRIPT-PROBE · 2 AUTOMATED-TEST)

**Reconciliation source (definitive gate report):** `docs/planning/launch-report-20261009T191940Z.json` — 173 rows, 165 PASS / 8 WAIVED / 0 FAIL; verdict FAIL solely because the 8 waiver signatories are blank (task 4.5 signs). The earlier `launch-report-20261009T165246Z.json` (64 rows) is historical evidence, not a reconciliation source.

**Section tally:** 7 PASS + 0 WAIVED = 7 rows — every report row with `section: 6` appears exactly once below, no extras, none missing (7/173 of the full census).

**Disposition notation:** `✅ PASS` = report `result: PASS`, `exitStatus: 0` (all 173 rows carry exitStatus 0). `☐ WHY` = report `result: WAIVED` — the row carries its waiver verbatim from the report's `waivers[]` array (WHY text + named owner), keyed to the `deferred-items.md` ledger pointer; full waiver text in the Waiver detail section below. All evidence paths are repo-relative.

## Matrix (rowId → modality → command → evidenceRef → disposition)

| rowId | modality | command | evidenceRef | disposition |
|---|---|---|---|---|
| `6.1` | SCRIPT-PROBE | `bun run scripts/load/load-test.ts --url http://127.0.0.1:3100` | `logs/2026-10-09T22-12-09/load-test.log` | ✅ PASS |
| `6.2` | SCRIPT-PROBE | `bun run scripts/load/matching-latency.ts` | `logs/2026-10-09T22-12-09/matching-latency.log` | ✅ PASS |
| `6.3` | SCRIPT-PROBE | `bun run scripts/load/ws-soak.ts --url ws://127.0.0.1:3101` | `logs/2026-10-09T22-12-09/ws-soak.log` | ✅ PASS |
| `6.4` | SCRIPT-PROBE | `bun run scripts/load/probe-explain-analyze.ts` | `logs/2026-10-09T22-12-09/probe-explain-analyze.log` | ✅ PASS |
| `6.5` | AUTOMATED-TEST | `bun run test:graphql backend/graphql/test/query-count-regression.test.ts` | `logs/2026-10-09T22-12-09/test-graphql-query-count-regression.log` | ✅ PASS |
| `6.6` | SCRIPT-PROBE | `bun run scripts/load/probe-indexes.ts` | `logs/2026-10-09T22-12-09/probe-indexes.log` | ✅ PASS |
| `6.7` | AUTOMATED-TEST | `bun run test:graphql backend/graphql/test/notification-query.test.ts` | `logs/2026-10-09T22-12-09/test-graphql-notification-query.log` | ✅ PASS |

## Reproducibility

- Row registry: `scripts/launch/launch-checklist.ts` · gate harness: `scripts/launch/launch-gate.ts` · report writer: `scripts/launch/launch-report.ts` (per-row tuples + stages + waivers + verdict)
- Re-run: `LOAD_TEST_EMAIL=… LOAD_TEST_PASSWORD=… ADMIN_PASSWORD='Seed_Pass1!' bun run scripts/launch/launch-gate.ts` (drill servers on `127.0.0.1:3100` / `:3101`); log evidence under `logs/<run-stamp>/`
- This matrix: 7/7 §6 rows reconciled 1:1 with the definitive report; count-verified (total across §1–§9 matrices: 173/173).

