# Evidence Matrix — §2. Financial & Escrow Safeguards (Task 5.3 · REQ-013 AC-3)

**Checklist section:** `docs/planning/PRODUCTION_READINESS.md` §2 — Financial & Escrow Safeguards · **25 rows** (25 AUTOMATED-TEST)

**Reconciliation source (definitive gate report):** `docs/planning/launch-report-20261009T191940Z.json` — 173 rows, 165 PASS / 8 WAIVED / 0 FAIL; verdict FAIL solely because the 8 waiver signatories are blank (task 4.5 signs). The earlier `launch-report-20261009T165246Z.json` (64 rows) is historical evidence, not a reconciliation source.

**Section tally:** 25 PASS + 0 WAIVED = 25 rows — every report row with `section: 2` appears exactly once below, no extras, none missing (25/173 of the full census).

**Disposition notation:** `✅ PASS` = report `result: PASS`, `exitStatus: 0` (all 173 rows carry exitStatus 0). `☐ WHY` = report `result: WAIVED` — the row carries its waiver verbatim from the report's `waivers[]` array (WHY text + named owner), keyed to the `deferred-items.md` ledger pointer; full waiver text in the Waiver detail section below. All evidence paths are repo-relative.

## Matrix (rowId → modality → command → evidenceRef → disposition)

| rowId | modality | command | evidenceRef | disposition |
|---|---|---|---|---|
| `2.1.1` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-lifecycle.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-lifecycle.service.test.ts.log` | ✅ PASS |
| `2.1.2` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-lifecycle.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-lifecycle.service.test.ts.log` | ✅ PASS |
| `2.1.3` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-lifecycle.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-lifecycle.service.test.ts.log` | ✅ PASS |
| `2.1.4` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-lifecycle.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-lifecycle.service.test.ts.log` | ✅ PASS |
| `2.1.5` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-lifecycle.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-lifecycle.service.test.ts.log` | ✅ PASS |
| `2.2.1` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-lifecycle.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-lifecycle.service.test.ts.log` | ✅ PASS |
| `2.2.2` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-lifecycle.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-lifecycle.service.test.ts.log` | ✅ PASS |
| `2.2.3` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-lifecycle.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-lifecycle.service.test.ts.log` | ✅ PASS |
| `2.2.4` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-lifecycle.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-lifecycle.service.test.ts.log` | ✅ PASS |
| `2.2.5` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-lifecycle.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-lifecycle.service.test.ts.log` | ✅ PASS |
| `2.2.6` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-lifecycle.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-lifecycle.service.test.ts.log` | ✅ PASS |
| `2.3.1` | AUTOMATED-TEST | `bun run test:graphql frontend/graphql/test/billing/escrow-denial-codes.test.ts` | `logs/2026-10-09T22-12-09/test-graphql-escrow-denial-codes.log` | ✅ PASS |
| `2.3.2` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-lifecycle.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-lifecycle.service.test.ts.log` | ✅ PASS |
| `2.3.3` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/db/test/logic/billing/launch-financial-probe.test.ts` | `logs/2026-10-09T22-12-09/backend/db/test/logic/billing/launch-financial-probe.test.ts.log` | ✅ PASS |
| `2.3.4` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/db/test/logic/billing/launch-financial-probe.test.ts` | `logs/2026-10-09T22-12-09/backend/db/test/logic/billing/launch-financial-probe.test.ts.log` | ✅ PASS |
| `2.3.5` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/db/test/logic/billing/launch-financial-probe.test.ts` | `logs/2026-10-09T22-12-09/backend/db/test/logic/billing/launch-financial-probe.test.ts.log` | ✅ PASS |
| `2.4.1` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-arbitration.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-arbitration.service.test.ts.log` | ✅ PASS |
| `2.4.2` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-arbitration.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-arbitration.service.test.ts.log` | ✅ PASS |
| `2.4.3` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-arbitration.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-arbitration.service.test.ts.log` | ✅ PASS |
| `2.4.4` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-arbitration.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-arbitration.service.test.ts.log` | ✅ PASS |
| `2.5.1` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/billing/wallet.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/billing/wallet.service.test.ts.log` | ✅ PASS |
| `2.5.2` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/billing/admin-financial-auditing.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/billing/admin-financial-auditing.service.test.ts.log` | ✅ PASS |
| `2.5.3` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/billing/admin-financial-auditing.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/billing/admin-financial-auditing.service.test.ts.log` | ✅ PASS |
| `2.5.4` | AUTOMATED-TEST | `bun run test:graphql frontend/graphql/test/billing/escrow-denial-codes.test.ts` | `logs/2026-10-09T22-12-09/test-graphql-escrow-denial-codes.log` | ✅ PASS |
| `2.5.5` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/db/test/logic/billing/launch-financial-probe.test.ts` | `logs/2026-10-09T22-12-09/backend/db/test/logic/billing/launch-financial-probe.test.ts.log` | ✅ PASS |

## Reproducibility

- Row registry: `scripts/launch/launch-checklist.ts` · gate harness: `scripts/launch/launch-gate.ts` · report writer: `scripts/launch/launch-report.ts` (per-row tuples + stages + waivers + verdict)
- Re-run: `LOAD_TEST_EMAIL=… LOAD_TEST_PASSWORD=… ADMIN_PASSWORD='Seed_Pass1!' bun run scripts/launch/launch-gate.ts` (drill servers on `127.0.0.1:3100` / `:3101`); log evidence under `logs/<run-stamp>/`
- This matrix: 25/25 §2 rows reconciled 1:1 with the definitive report; count-verified (total across §1–§9 matrices: 173/173).

