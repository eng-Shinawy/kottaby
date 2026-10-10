# Evidence Matrix — §5. State Machine Invariant Verification (Task 5.3 · REQ-013 AC-3)

**Checklist section:** `docs/planning/PRODUCTION_READINESS.md` §5 — State Machine Invariant Verification · **34 rows** (30 AUTOMATED-TEST · 4 SCRIPT-PROBE)

**Reconciliation source (definitive gate report):** `docs/planning/launch-report-20261009T191940Z.json` — 173 rows, 165 PASS / 8 WAIVED / 0 FAIL; verdict FAIL solely because the 8 waiver signatories are blank (task 4.5 signs). The earlier `launch-report-20261009T165246Z.json` (64 rows) is historical evidence, not a reconciliation source.

**Section tally:** 31 PASS + 3 WAIVED = 34 rows — every report row with `section: 5` appears exactly once below, no extras, none missing (34/173 of the full census).

**Disposition notation:** `✅ PASS` = report `result: PASS`, `exitStatus: 0` (all 173 rows carry exitStatus 0). `☐ WHY` = report `result: WAIVED` — the row carries its waiver verbatim from the report's `waivers[]` array (WHY text + named owner), keyed to the `deferred-items.md` ledger pointer; full waiver text in the Waiver detail section below. All evidence paths are repo-relative.

## Matrix (rowId → modality → command → evidenceRef → disposition)

| rowId | modality | command | evidenceRef | disposition |
|---|---|---|---|---|
| `5.1.1` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-lifecycle.enforcement.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-lifecycle.enforcement.test.ts.log` | ☐ WHY + owner — waived (ledger D10); full text in Waiver detail below; signatory blank at report time |
| `5.1.2` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-lifecycle.enforcement.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-lifecycle.enforcement.test.ts.log` | ☐ WHY + owner — waived (ledger D10); full text in Waiver detail below; signatory blank at report time |
| `5.1.3` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-lifecycle.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-lifecycle.service.test.ts.log` | ✅ PASS |
| `5.1.4` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/db/test/repo/classes/session.repository.test.ts` | `logs/2026-10-09T22-12-09/backend/db/test/repo/classes/session.repository.test.ts.log` | ✅ PASS |
| `5.1.5` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-lifecycle.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-lifecycle.service.test.ts.log` | ✅ PASS |
| `5.1.6` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/sessions/in-session-lock-release.journey.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/sessions/in-session-lock-release.journey.test.ts.log` | ✅ PASS |
| `5.1.7` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-report.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-report.service.test.ts.log` | ✅ PASS |
| `5.1.8` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-report.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-report.service.test.ts.log` | ✅ PASS |
| `5.2.1` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts.log` | ✅ PASS |
| `5.2.2` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/teachers/evaluation-booking.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/teachers/evaluation-booking.service.test.ts.log` | ✅ PASS |
| `5.2.3` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/teachers/cooldown-state-machine.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/teachers/cooldown-state-machine.test.ts.log` | ✅ PASS |
| `5.2.4` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/teachers/cooldown-state-machine.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/teachers/cooldown-state-machine.test.ts.log` | ✅ PASS |
| `5.2.5` | AUTOMATED-TEST | `bun run test:graphql backend/graphql/test/admin-applicant-override.wire.test.ts` | `logs/2026-10-09T22-12-09/test-graphql-admin-applicant-override.log` | ✅ PASS |
| `5.2.6` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/teachers/applicant-student-conversion.journey.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/teachers/applicant-student-conversion.journey.test.ts.log` | ✅ PASS |
| `5.3.1` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/db/test/repo/students/student.repository.test.ts` | `logs/2026-10-09T22-12-09/backend/db/test/repo/students/student.repository.test.ts.log` | ✅ PASS |
| `5.3.2` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/billing/subscription-activation.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/billing/subscription-activation.service.test.ts.log` | ✅ PASS |
| `5.3.3` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/billing/subscription-expiry.journey.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/billing/subscription-expiry.journey.test.ts.log` | ✅ PASS |
| `5.3.4` | AUTOMATED-TEST | `bun run test:graphql backend/graphql/test/session-booking-balance.test.ts` | `logs/2026-10-09T22-12-09/test-graphql-session-booking-balance.log` | ✅ PASS |
| `5.3.5` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-lifecycle.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-lifecycle.service.test.ts.log` | ✅ PASS |
| `5.3.6` | AUTOMATED-TEST | `bun run test:graphql frontend/graphql/test/subscription-admin/subscription-admin.test.ts` | `logs/2026-10-09T22-12-09/test-graphql-subscription-admin.log` | ✅ PASS |
| `5.4.1` | SCRIPT-PROBE | `bun run scripts/launch/probe-constraints.ts` | `logs/2026-10-09T22-12-09/probe-constraints.log` | ✅ PASS |
| `5.4.2` | SCRIPT-PROBE | `bun run scripts/launch/probe-constraints.ts` | `logs/2026-10-09T22-12-09/probe-constraints.log` | ✅ PASS |
| `5.4.3` | SCRIPT-PROBE | `bun run scripts/launch/probe-constraints.ts` | `logs/2026-10-09T22-12-09/probe-constraints.log` | ✅ PASS |
| `5.4.4` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-lifecycle.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-lifecycle.service.test.ts.log` | ✅ PASS |
| `5.4.5` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/billing/admin-financial-auditing.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/billing/admin-financial-auditing.service.test.ts.log` | ✅ PASS |
| `5.4.6` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/db/test/logic/billing/financial-immutability.test.ts` | `logs/2026-10-09T22-12-09/backend/db/test/logic/billing/financial-immutability.test.ts.log` | ✅ PASS |
| `5.4.7` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/teachers/teacher-re-evaluation.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/teachers/teacher-re-evaluation.service.test.ts.log` | ✅ PASS |
| `5.4.8` | SCRIPT-PROBE | `bun run scripts/launch/probe-constraints.ts` | `logs/2026-10-09T22-12-09/probe-constraints.log` | ✅ PASS |
| `5.5.1` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/parents/parent-monitoring.journey.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/parents/parent-monitoring.journey.test.ts.log` | ✅ PASS |
| `5.5.2` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/parents/parent-full-journey.journey.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/parents/parent-full-journey.journey.test.ts.log` | ✅ PASS |
| `5.5.3` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/parents/parent-monitoring.journey.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/parents/parent-monitoring.journey.test.ts.log` | ✅ PASS |
| `5.5.4` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/parents/parent-link-request.chaos.test.ts` | `logs/2026-10-09T22-12-09/backend/services/parents/parent-link-request.chaos.test.ts.log` | ✅ PASS |
| `5.5.5` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/parents/parent-monitoring.journey.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/parents/parent-monitoring.journey.test.ts.log` | ✅ PASS |
| `5.5.6` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/parents/parent-link-request.service.test.ts` | `logs/2026-10-09T22-12-09/backend/services/parents/parent-link-request.service.test.ts.log` | ☐ WHY + owner — waived (ledger D13); full text in Waiver detail below; signatory blank at report time |

## Waiver detail (verbatim from the report's `waivers[]`)

**5.1.1:**

- **WHY:** Terminal-state protection is enforced by application-layer guarded UPDATEs (the 5x5 enforcement sweep plus the session-state-machine journey pins); a DB-level session-status guard trigger stays deferred (deferred-items ledger D10) — a signed exception, never a silent skip.
- **Owner:** Dev 3
- **Ledger pointer:** `deferred-items.md` D10 (✅ resolved-pointer, waived-with-sign-off)
- **Signatory:** blank in the report (`signatory: ""`) — the task-4.5 human sign-off attaches it; an unsigned waiver blocks the verdict exactly like a failed row (`PRODUCTION_READINESS.md:12`)

**5.1.2:**

- **WHY:** Terminal-state protection is enforced by application-layer guarded UPDATEs (the 5x5 enforcement sweep plus the session-state-machine journey pins); a DB-level session-status guard trigger stays deferred (deferred-items ledger D10) — a signed exception, never a silent skip.
- **Owner:** Dev 3
- **Ledger pointer:** `deferred-items.md` D10 (✅ resolved-pointer, waived-with-sign-off)
- **Signatory:** blank in the report (`signatory: ""`) — the task-4.5 human sign-off attaches it; an unsigned waiver blocks the verdict exactly like a failed row (`PRODUCTION_READINESS.md:12`)

**5.5.6:**

- **WHY:** Expiry is enforced at read/claim time (strict expiresAt > now) and the sweep/reminder primitives ship as on-demand ops triggers (ops:sweep-link-requests / ops:remind-link-requests); scheduled wiring is waived-with-sign-off to the canonical doc's cron-stream backlog ticket (deferred-items ledger D13). The arming runbook states the on-demand cadence that bounds the re-request lockout window.
- **Owner:** Dev 3
- **Ledger pointer:** `deferred-items.md` D13 (✅ resolved-pointer, waived-with-sign-off)
- **Signatory:** blank in the report (`signatory: ""`) — the task-4.5 human sign-off attaches it; an unsigned waiver blocks the verdict exactly like a failed row (`PRODUCTION_READINESS.md:12`)

## Reproducibility

- Row registry: `scripts/launch/launch-checklist.ts` · gate harness: `scripts/launch/launch-gate.ts` · report writer: `scripts/launch/launch-report.ts` (per-row tuples + stages + waivers + verdict)
- Re-run: `LOAD_TEST_EMAIL=… LOAD_TEST_PASSWORD=… ADMIN_PASSWORD='Seed_Pass1!' bun run scripts/launch/launch-gate.ts` (drill servers on `127.0.0.1:3100` / `:3101`); log evidence under `logs/<run-stamp>/`
- This matrix: 34/34 §5 rows reconciled 1:1 with the definitive report; count-verified (total across §1–§9 matrices: 173/173).

