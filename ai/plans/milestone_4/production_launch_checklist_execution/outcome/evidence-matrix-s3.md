# Evidence Matrix — §3. Real-Time Reliability (Task 5.3 · REQ-013 AC-3)

**Checklist section:** `docs/planning/PRODUCTION_READINESS.md` §3 — Real-Time Reliability · **17 rows** (17 AUTOMATED-TEST)

**Reconciliation source (definitive gate report):** `docs/planning/launch-report-20261009T191940Z.json` — 173 rows, 165 PASS / 8 WAIVED / 0 FAIL; verdict FAIL solely because the 8 waiver signatories are blank (task 4.5 signs). The earlier `launch-report-20261009T165246Z.json` (64 rows) is historical evidence, not a reconciliation source.

**Section tally:** 16 PASS + 1 WAIVED = 17 rows — every report row with `section: 3` appears exactly once below, no extras, none missing (17/173 of the full census).

**Disposition notation:** `✅ PASS` = report `result: PASS`, `exitStatus: 0` (all 173 rows carry exitStatus 0). `☐ WHY` = report `result: WAIVED` — the row carries its waiver verbatim from the report's `waivers[]` array (WHY text + named owner), keyed to the `deferred-items.md` ledger pointer; full waiver text in the Waiver detail section below. All evidence paths are repo-relative.

## Matrix (rowId → modality → command → evidenceRef → disposition)

| rowId | modality | command | evidenceRef | disposition |
|---|---|---|---|---|
| `3.1.1` | AUTOMATED-TEST | `bun run test:graphql backend/graphql/test/user-activity.integration.test.ts` | `logs/2026-10-09T22-12-09/test-graphql-user-activity.log` | ✅ PASS |
| `3.1.2` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/teachers/teacher-inactivity-auto-offline.journey.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/teachers/teacher-inactivity-auto-offline.journey.test.ts.log` | ✅ PASS |
| `3.1.3` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/teachers/teacher-inactivity-auto-offline.journey.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/teachers/teacher-inactivity-auto-offline.journey.test.ts.log` | ✅ PASS |
| `3.1.4` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/teachers/teacher-availability.journey.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/teachers/teacher-availability.journey.test.ts.log` | ✅ PASS |
| `3.2.1` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/notifications/reconnect-catchup.journey.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/notifications/reconnect-catchup.journey.test.ts.log` | ✅ PASS |
| `3.2.2` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/notifications/reconnect-catchup.journey.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/notifications/reconnect-catchup.journey.test.ts.log` | ✅ PASS |
| `3.2.3` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/notifications/reconnect-catchup.journey.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/notifications/reconnect-catchup.journey.test.ts.log` | ✅ PASS |
| `3.2.4` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/notifications/reconnect-catchup.journey.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/notifications/reconnect-catchup.journey.test.ts.log` | ✅ PASS |
| `3.3.1` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/teachers/on-demand-matching.journey.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/teachers/on-demand-matching.journey.test.ts.log` | ✅ PASS |
| `3.3.2` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/sessions/in-session-lock-release.journey.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/sessions/in-session-lock-release.journey.test.ts.log` | ✅ PASS |
| `3.3.3` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/sessions/in-session-lock-release.journey.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/sessions/in-session-lock-release.journey.test.ts.log` | ☐ WHY + owner — waived (ledger D1); full text in Waiver detail below; signatory blank at report time |
| `3.3.4` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/sessions/in-session-lock-release.journey.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/sessions/in-session-lock-release.journey.test.ts.log` | ✅ PASS |
| `3.4.1` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/notifications/reconnect-catchup.journey.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/notifications/reconnect-catchup.journey.test.ts.log` | ✅ PASS |
| `3.4.2` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/services/classes/session-report-notification.test.ts` | `logs/2026-10-09T22-12-09/backend/services/classes/session-report-notification.test.ts.log` | ✅ PASS |
| `3.4.3` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/notifications/j2-cohort-broadcast-offline-persistence.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/notifications/j2-cohort-broadcast-offline-persistence.test.ts.log` | ✅ PASS |
| `3.4.4` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts test/workflows/notifications/j2-cohort-broadcast-offline-persistence.test.ts` | `logs/2026-10-09T22-12-09/test/workflows/notifications/j2-cohort-broadcast-offline-persistence.test.ts.log` | ✅ PASS |
| `3.4.5` | AUTOMATED-TEST | `bun run test/scripts/run-test.ts backend/enum/notifications/notification-type-census.test.ts` | `logs/2026-10-09T22-12-09/backend/enum/notifications/notification-type-census.test.ts.log` | ✅ PASS |

## Waiver detail (verbatim from the report's `waivers[]`)

**3.3.3:**

- **WHY:** As-built, the directory-level NOT-EXISTS exclusion (backend/db/repo/teachers/teacher.repository.matching.helpers.ts:129-142) is the MVP availability gate; booking-time re-assertion is waived-with-sign-off to the matching-flow backlog ticket (deferred-items ledger D1). The in-session-lock-release journey's deferred-restore lane deliberately books an in-session teacher today and must be updated if a gate ever ships.
- **Owner:** Dev 3 (matching-flow backlog)
- **Ledger pointer:** `deferred-items.md` D1 (✅ resolved-pointer, waived-with-sign-off)
- **Signatory:** blank in the report (`signatory: ""`) — the task-4.5 human sign-off attaches it; an unsigned waiver blocks the verdict exactly like a failed row (`PRODUCTION_READINESS.md:12`)

## Reproducibility

- Row registry: `scripts/launch/launch-checklist.ts` · gate harness: `scripts/launch/launch-gate.ts` · report writer: `scripts/launch/launch-report.ts` (per-row tuples + stages + waivers + verdict)
- Re-run: `LOAD_TEST_EMAIL=… LOAD_TEST_PASSWORD=… ADMIN_PASSWORD='Seed_Pass1!' bun run scripts/launch/launch-gate.ts` (drill servers on `127.0.0.1:3100` / `:3101`); log evidence under `logs/<run-stamp>/`
- This matrix: 17/17 §3 rows reconciled 1:1 with the definitive report; count-verified (total across §1–§9 matrices: 173/173).

